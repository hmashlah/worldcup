/**
 * Cloudflare Pages Function: receives a webhook from a Postgres trigger
 * after a new wc26_profiles row is inserted, and forwards the event as
 * a Telegram message to the admin.
 *
 * Endpoint: POST https://<pages-host>/notify-signup
 *
 * Required environment variables (set in Cloudflare Pages → Settings → Env vars):
 *   TELEGRAM_BOT_TOKEN  — token from @BotFather
 *   TELEGRAM_CHAT_ID    — your chat id from @userinfobot (numeric, can be negative)
 *   WC26_WEBHOOK_SECRET — shared secret with the Postgres trigger; rejects
 *                        calls without a matching `x-wc26-secret` header.
 *
 * Postgres-trigger payload (JSON):
 *   { display_name: string, email?: string, user_id: string, created_at: string }
 */

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  WC26_WEBHOOK_SECRET: string;
}

interface SignupPayload {
  display_name?: string;
  email?: string;
  user_id?: string;
  created_at?: string;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  // Auth: simple shared secret (the trigger sets the same header)
  const secret = ctx.request.headers.get('x-wc26-secret') ?? '';
  if (!ctx.env.WC26_WEBHOOK_SECRET || secret !== ctx.env.WC26_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  let body: SignupPayload;
  try {
    body = await ctx.request.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const name = body.display_name ?? '(unnamed)';
  const email = body.email ?? '';
  const lines = [
    `🎉 *New WC26 signup*`,
    `*${name}*${email ? ` — \`${email}\`` : ''}`,
    `Approve in the [Admin tab](https://worldcup-1jo.pages.dev/?tab=admin).`,
  ];

  const tg = await fetch(
    `https://api.telegram.org/bot${ctx.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: ctx.env.TELEGRAM_CHAT_ID,
        text: lines.join('\n'),
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    },
  );

  if (!tg.ok) {
    const errText = await tg.text();
    return new Response(`telegram error: ${errText}`, { status: 502 });
  }

  return new Response('ok');
};
