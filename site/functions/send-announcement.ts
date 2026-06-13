/**
 * Cloudflare Pages Function: send a one-shot announcement email to all
 * approved league members. Reusable for any future "we shipped X"
 * update — caller posts the rendered subject/html/text.
 *
 * Endpoint: POST https://<host>/send-announcement
 * Auth:     x-wc26-secret header (shared with pg_cron / sync etc.)
 *
 * Required env vars (Cloudflare Pages → Settings → Env vars):
 *   RESEND_API_KEY              — from resend.com → API Keys
 *   RESEND_FROM                 — e.g. "WC26 League <reminders@simple-courses.com>"
 *   APP_URL                     — e.g. "https://worldcup-1jo.pages.dev"
 *   SUPABASE_URL                — your project URL
 *   SUPABASE_SERVICE_ROLE_KEY   — bypasses RLS so we can read profiles + emails
 *   WC26_WEBHOOK_SECRET         — shared secret
 *
 * Request body:
 *   {
 *     subject: string;                      // email subject line
 *     html:    string;                      // body HTML; "{{name}}" interpolated per recipient
 *     text:    string;                      // body plaintext; same {{name}} token
 *     dryRun?: boolean;                     // if true, returns the recipient list without sending
 *     onlyTo?: string[];                    // optional: filter recipients to these emails (smoke test)
 *   }
 *
 * Response: { sent, failed, recipients, errors }
 */

interface Env {
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  APP_URL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WC26_WEBHOOK_SECRET: string;
}

interface RequestBody {
  subject?: string;
  html?: string;
  text?: string;
  dryRun?: boolean;
  onlyTo?: string[];
}

interface ApprovedUser {
  user_id: string;
  display_name: string;
  email: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function interpolate(template: string, name: string, escape: boolean): string {
  const val = escape ? escapeHtml(name) : name;
  return template.replaceAll('{{name}}', val);
}

async function fetchApprovedUsers(env: Env): Promise<ApprovedUser[]> {
  // Two Postgrest calls because email lives on auth.users (which has its
  // own RLS / API restrictions even for service role) and display_name
  // lives on wc26_profiles. Easiest: pull profiles + emails separately
  // and join in code.
  const profilesRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/wc26_profiles?select=user_id,display_name&approved=eq.true`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!profilesRes.ok) {
    throw new Error(`profiles select ${profilesRes.status}: ${await profilesRes.text()}`);
  }
  const profiles: Array<{ user_id: string; display_name: string }> = await profilesRes.json();
  if (profiles.length === 0) return [];

  // auth.users via the admin API — only the service role can hit this.
  // Page through if you ever exceed 50; for an 8-user league it's one call.
  const usersRes = await fetch(
    `${env.SUPABASE_URL}/auth/v1/admin/users?per_page=200`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!usersRes.ok) {
    throw new Error(`auth users ${usersRes.status}: ${await usersRes.text()}`);
  }
  const usersBody: { users: Array<{ id: string; email?: string }> } = await usersRes.json();
  const emailById = new Map<string, string>();
  for (const u of usersBody.users ?? []) {
    if (u.email) emailById.set(u.id, u.email);
  }

  const out: ApprovedUser[] = [];
  for (const p of profiles) {
    const email = emailById.get(p.user_id);
    if (!email) continue; // user with no email — skip silently
    out.push({ user_id: p.user_id, display_name: p.display_name, email });
  }
  return out;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  // 1. Auth.
  const secret = ctx.request.headers.get('x-wc26-secret') ?? '';
  if (!ctx.env.WC26_WEBHOOK_SECRET || secret !== ctx.env.WC26_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  // 2. Parse + validate body.
  let body: RequestBody;
  try {
    body = await ctx.request.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const { subject, html, text, dryRun, onlyTo } = body;
  if (!subject || !html || !text) {
    return Response.json(
      { error: 'subject, html, and text are all required' },
      { status: 400 },
    );
  }

  // 3. Fetch approved users.
  let users: ApprovedUser[];
  try {
    users = await fetchApprovedUsers(ctx.env);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
  if (onlyTo && onlyTo.length > 0) {
    const allowed = new Set(onlyTo.map(s => s.toLowerCase()));
    users = users.filter(u => allowed.has(u.email.toLowerCase()));
  }

  // 4. Dry run — just return the recipient list.
  if (dryRun) {
    return Response.json({
      dryRun: true,
      recipients: users.map(u => ({ email: u.email, name: u.display_name })),
    });
  }

  // 5. Send. Concurrency cap to stay friendly to Resend's rate limits.
  const results = { sent: 0, failed: 0, errors: [] as string[] };
  const concurrency = 5;

  for (let i = 0; i < users.length; i += concurrency) {
    const slice = users.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async (u) => {
        const personalHtml = interpolate(html, u.display_name, true);
        const personalText = interpolate(text, u.display_name, false);
        try {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${ctx.env.RESEND_API_KEY}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              from: ctx.env.RESEND_FROM,
              to: u.email,
              subject,
              html: personalHtml,
              text: personalText,
            }),
          });
          if (!res.ok) {
            results.failed++;
            results.errors.push(`${u.email}: ${res.status} ${await res.text()}`);
          } else {
            results.sent++;
          }
        } catch (e: unknown) {
          results.failed++;
          results.errors.push(
            `${u.email}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }),
    );
  }

  return Response.json({
    sent: results.sent,
    failed: results.failed,
    total: users.length,
    errors: results.errors,
  });
};
