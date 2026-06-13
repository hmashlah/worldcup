/**
 * Cloudflare Pages Function: receives a daily webhook from pg_cron and
 * sends "you haven't picked yet" emails to approved users who are
 * missing predictions for matches kicking off in the next 24h.
 *
 * Endpoint: POST https://<pages-host>/send-reminders
 *
 * Required environment variables (Cloudflare Pages → Settings → Env vars):
 *   RESEND_API_KEY        — from resend.com → API Keys
 *   RESEND_FROM           — e.g. "WC26 League <reminders@your-verified-domain>"
 *   APP_URL               — e.g. "https://worldcup-1jo.pages.dev"
 *   WC26_WEBHOOK_SECRET   — shared secret with pg_cron (same one used for signup)
 *
 * Request body (sent by pg_cron via pg_net):
 *   {
 *     reminders: Array<{
 *       email: string;
 *       display_name: string;
 *       missing: Array<{ match_id: string; kickoff_at: string }>;
 *     }>;
 *   }
 *
 * Response: { sent: number, failed: number, errors: string[] }
 */

interface Env {
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  APP_URL: string;
  WC26_WEBHOOK_SECRET: string;
}

interface ReminderRow {
  email: string;
  display_name: string;
  missing: Array<{ match_id: string; kickoff_at: string }>;
}

interface RequestBody {
  reminders?: ReminderRow[];
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function renderEmail(row: ReminderRow, appUrl: string): { subject: string; html: string; text: string } {
  const n = row.missing.length;
  const subject = `Reminder: ${n} prediction${n === 1 ? '' : 's'} due in the next 24h`;

  const list = row.missing
    .map(m => {
      const t = new Date(m.kickoff_at).toUTCString();
      return `<li><code>${escapeHtml(m.match_id)}</code> — ${escapeHtml(t)}</li>`;
    })
    .join('');

  const textList = row.missing
    .map(m => `  • ${m.match_id} — ${new Date(m.kickoff_at).toUTCString()}`)
    .join('\n');

  const html = `
    <p>Hi ${escapeHtml(row.display_name)},</p>
    <p>You haven't submitted predictions for ${n} match${n === 1 ? '' : 'es'} kicking off in the next 24 hours:</p>
    <ul>${list}</ul>
    <p><a href="${appUrl}">Open the league</a> and lock in your picks before kickoff.</p>
    <p style="color:#888;font-size:12px">You're getting this because you're an approved member of the WC26 prediction league. Picks lock at kickoff.</p>
  `;

  const text = [
    `Hi ${row.display_name},`,
    ``,
    `You haven't submitted predictions for ${n} match${n === 1 ? '' : 'es'} kicking off in the next 24h:`,
    textList,
    ``,
    `Open the league: ${appUrl}`,
  ].join('\n');

  return { subject, html, text };
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  // 1. Auth — same shared-secret pattern as notify-signup.
  const secret = ctx.request.headers.get('x-wc26-secret') ?? '';
  if (!ctx.env.WC26_WEBHOOK_SECRET || secret !== ctx.env.WC26_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  // 2. Parse body.
  let body: RequestBody;
  try {
    body = await ctx.request.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const reminders = body.reminders ?? [];
  if (reminders.length === 0) {
    return Response.json({ sent: 0, failed: 0, errors: [] });
  }

  // 3. Send via Resend, in parallel but with a small concurrency cap so
  //    we don't get rate-limited on big days.
  const results = { sent: 0, failed: 0, errors: [] as string[] };
  const concurrency = 5;

  for (let i = 0; i < reminders.length; i += concurrency) {
    const slice = reminders.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async (row) => {
        const { subject, html, text } = renderEmail(row, ctx.env.APP_URL);
        try {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'authorization': `Bearer ${ctx.env.RESEND_API_KEY}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              from: ctx.env.RESEND_FROM,
              to: row.email,
              subject,
              html,
              text,
            }),
          });
          if (!res.ok) {
            results.failed++;
            results.errors.push(`${row.email}: ${res.status} ${await res.text()}`);
          } else {
            results.sent++;
          }
        } catch (e: unknown) {
          results.failed++;
          results.errors.push(`${row.email}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );
  }

  return Response.json(results);
};
