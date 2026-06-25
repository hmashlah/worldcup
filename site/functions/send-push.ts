/**
 * Cloudflare Pages Function: sends push notifications to specified users.
 *
 * Endpoint: POST https://<pages-host>/send-push
 *
 * Required environment variables (Cloudflare Pages → Settings → Env vars):
 *   VAPID_PRIVATE_KEY     — VAPID private key (base64url)
 *   VAPID_PUBLIC_KEY      — VAPID public key (base64url)
 *   VAPID_SUBJECT         — mailto:your@email.com
 *   SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key
 *   WC26_WEBHOOK_SECRET   — shared secret for auth
 *
 * Request body:
 *   {
 *     userIds?: string[];        // target specific users (omit = all subscriptions)
 *     title: string;
 *     body: string;
 *     url?: string;              // URL to open on click
 *   }
 *
 * Uses the Web Push protocol (RFC 8030 + RFC 8291 + RFC 8292).
 * Since Cloudflare Workers don't have Node.js crypto, we use the
 * Web Crypto API to implement VAPID + encryption.
 */

interface Env {
  VAPID_PRIVATE_KEY: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WC26_WEBHOOK_SECRET: string;
}

interface PushPayload {
  userIds?: string[];
  title: string;
  body: string;
  url?: string;
}

interface PushSub {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { env, request } = ctx;

  // Auth check
  const secret = request.headers.get('x-wc26-secret');
  if (secret !== env.WC26_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const payload: PushPayload = await request.json();
  if (!payload.title || !payload.body) {
    return new Response(JSON.stringify({ error: 'title and body required' }), { status: 400 });
  }

  // Fetch subscriptions from Supabase
  let url = `${env.SUPABASE_URL}/rest/v1/wc26_push_subscriptions?select=user_id,endpoint,p256dh,auth`;
  if (payload.userIds && payload.userIds.length > 0) {
    url += `&user_id=in.(${payload.userIds.join(',')})`;
  }

  const subsRes = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!subsRes.ok) {
    return new Response(JSON.stringify({ error: 'failed to fetch subscriptions' }), { status: 500 });
  }

  const subscriptions: PushSub[] = await subsRes.json();
  if (subscriptions.length === 0) {
    return Response.json({ sent: 0, message: 'no subscriptions found' });
  }

  const notificationPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/',
  });

  // Send push to each subscription
  let sent = 0;
  let failed = 0;
  const expiredEndpoints: string[] = [];

  for (const sub of subscriptions) {
    try {
      const res = await sendWebPush(env, sub, notificationPayload);
      if (res.ok) {
        sent++;
      } else if (res.status === 404 || res.status === 410) {
        // Subscription expired or invalid - mark for deletion
        expiredEndpoints.push(sub.endpoint);
        failed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  // Clean up expired subscriptions
  if (expiredEndpoints.length > 0) {
    for (const endpoint of expiredEndpoints) {
      await fetch(
        `${env.SUPABASE_URL}/rest/v1/wc26_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
        {
          method: 'DELETE',
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );
    }
  }

  return Response.json({ sent, failed, expired: expiredEndpoints.length });
};

// ─── Web Push Implementation (using Web Crypto API) ──────────────────

async function sendWebPush(env: Env, sub: PushSub, payload: string): Promise<Response> {
  const endpoint = sub.endpoint;
  const audience = new URL(endpoint).origin;

  // Create JWT for VAPID
  const jwt = await createVapidJwt(env.VAPID_PRIVATE_KEY, audience, env.VAPID_SUBJECT);

  // Encrypt the payload using ECDH + HKDF + AES-GCM (RFC 8291)
  const encrypted = await encryptPayload(sub.p256dh, sub.auth, payload);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
    },
    body: encrypted,
  });

  return res;
}

async function createVapidJwt(
  privateKeyBase64: string,
  audience: string,
  subject: string
): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const claims = { aud: audience, exp: now + 12 * 3600, sub: subject };

  const headerB64 = base64urlEncode(JSON.stringify(header));
  const claimsB64 = base64urlEncode(JSON.stringify(claims));
  const unsigned = `${headerB64}.${claimsB64}`;

  // Import private key
  const keyData = base64urlDecode(privateKeyBase64);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    convertRawPrivateKeyToPkcs8(keyData),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  );

  // Convert DER signature to raw r||s
  const rawSig = derToRaw(new Uint8Array(signature));
  const sigB64 = base64urlEncodeBuffer(rawSig);

  return `${unsigned}.${sigB64}`;
}

async function encryptPayload(
  p256dhBase64: string,
  authBase64: string,
  payload: string
): Promise<ArrayBuffer> {
  const clientPublicKey = base64urlDecode(p256dhBase64);
  const authSecret = base64urlDecode(authBase64);

  // Generate local ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  ) as CryptoKeyPair;

  // Import client's public key
  const clientKey = await crypto.subtle.importKey(
    'raw',
    clientPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Derive shared secret via ECDH
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey },
    localKeyPair.privateKey,
    256
  );

  // Export local public key
  const localPublicKeyRaw = await crypto.subtle.exportKey('raw', localKeyPair.publicKey);
  const localPublicKeyBytes = new Uint8Array(localPublicKeyRaw);

  // Build info for HKDF
  const encoder = new TextEncoder();
  
  // PRK = HKDF-Extract(auth_secret, ecdh_secret)
  const prkKey = await crypto.subtle.importKey('raw', authSecret, { name: 'HKDF' }, false, ['deriveBits']);
  // Actually we need ikm=sharedSecret, salt=authSecret
  const ikmKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, ['deriveBits']);
  
  // IKM key info for auth: "WebPush: info\0" + client_public + server_public
  const keyInfoBuf = concatBuffers(
    encoder.encode('WebPush: info\0'),
    clientPublicKey,
    localPublicKeyBytes
  );

  // ikm = HKDF(salt=auth_secret, ikm=ecdh_secret, info="WebPush: info\0"||client||server, len=32)
  const ikmForContent = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: keyInfoBuf },
    ikmKey,
    256
  );

  // Content encryption key: HKDF(salt=salt, ikm=ikm, info="Content-Encoding: aes128gcm\0", len=16)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cekInfo = encoder.encode('Content-Encoding: aes128gcm\0');
  const ikmKeyFinal = await crypto.subtle.importKey('raw', ikmForContent, { name: 'HKDF' }, false, ['deriveBits']);
  
  const cekBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt, info: cekInfo },
    ikmKeyFinal,
    128
  );

  // Nonce: HKDF(salt=salt, ikm=ikm, info="Content-Encoding: nonce\0", len=12)
  const nonceInfo = encoder.encode('Content-Encoding: nonce\0');
  const nonceBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt, info: nonceInfo },
    ikmKeyFinal,
    96
  );

  // Encrypt with AES-128-GCM
  const cek = await crypto.subtle.importKey('raw', cekBits, { name: 'AES-GCM' }, false, ['encrypt']);
  
  // Pad the plaintext: payload + delimiter (0x02) 
  const payloadBytes = encoder.encode(payload);
  const paddedPayload = new Uint8Array(payloadBytes.length + 1);
  paddedPayload.set(payloadBytes);
  paddedPayload[payloadBytes.length] = 2; // delimiter

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonceBits },
    cek,
    paddedPayload
  );

  // Build aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65)
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = 65; // key length
  header.set(localPublicKeyBytes, 21);

  return concatBuffers(header, new Uint8Array(encrypted)).buffer;
}

// ─── Utility functions ───────────────────────────────────────────────

function base64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlEncodeBuffer(buf: Uint8Array): string {
  let binary = '';
  for (const byte of buf) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBuffers(...buffers: (Uint8Array | ArrayBuffer)[]): Uint8Array {
  const arrays = buffers.map(b => b instanceof Uint8Array ? b : new Uint8Array(b));
  const totalLength = arrays.reduce((acc, a) => acc + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/** Convert a 32-byte raw private key to PKCS8 DER for P-256 */
function convertRawPrivateKeyToPkcs8(rawKey: Uint8Array): ArrayBuffer {
  // PKCS8 wrapper for EC P-256 private key
  const pkcs8Header = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48,
    0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03,
    0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20,
  ]);
  return concatBuffers(pkcs8Header, rawKey).buffer;
}

/** Convert DER-encoded ECDSA signature to raw r||s (64 bytes) */
function derToRaw(der: Uint8Array): Uint8Array {
  // DER: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
  const raw = new Uint8Array(64);
  let offset = 2; // skip 0x30 <len>
  
  // R
  offset++; // skip 0x02
  const rLen = der[offset++];
  const rStart = rLen > 32 ? offset + (rLen - 32) : offset;
  const rDest = rLen < 32 ? 32 - rLen : 0;
  raw.set(der.slice(rStart, offset + rLen), rDest);
  offset += rLen;
  
  // S
  offset++; // skip 0x02
  const sLen = der[offset++];
  const sStart = sLen > 32 ? offset + (sLen - 32) : offset;
  const sDest = sLen < 32 ? 64 - sLen : 32;
  raw.set(der.slice(sStart, offset + sLen), sDest);
  
  return raw;
}
