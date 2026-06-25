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
 * Match IDs are translated to team-vs-team labels by fetching the
 * tournament's data.json once per invocation. KO matches whose teams
 * are still slot tokens (1A, W74) gracefully fall back to a readable
 * placeholder ("Winner Group A") via the prettySlot logic.
 *
 * Response: { sent: number, failed: number, errors: string[] }
 */

interface Env {
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  APP_URL: string;
  WC26_WEBHOOK_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface ReminderRow {
  email: string;
  display_name: string;
  missing: Array<{ match_id: string; kickoff_at: string }>;
}

interface RequestBody {
  reminders?: ReminderRow[];
}

interface MatchMeta {
  team1: string;
  team2: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Mirrors site/src/lib/tournament.ts prettySlot — turn a slot token
 *  ("1A", "W74", "3A/B/C/D/F") into something a human can read in an
 *  email when the bracket hasn't filled yet. */
function prettySlot(token: string): string {
  if (!token) return 'TBD';
  const direct = /^([12])([A-L])$/.exec(token);
  if (direct) return `${direct[1] === '1' ? 'Winner' : 'Runner-up'} Group ${direct[2]}`;
  const third = /^3([A-L/]+)$/.exec(token);
  if (third) return `3rd-place ${third[1]}`;
  const wm = /^W(\d+)$/.exec(token);
  if (wm) return `Winner of M${wm[1]}`;
  const lm = /^L(\d+)$/.exec(token);
  if (lm) return `Loser of M${lm[1]}`;
  return token;
}

interface DataJson {
  group_matches: Record<string, Array<{ id: string; team1: string; team2: string }>>;
  ko_matches: Array<{ id: string; team1: string; team2: string }>;
}

async function loadMatchMeta(host: string): Promise<Record<string, MatchMeta>> {
  const res = await fetch(`${host}/data.json`);
  if (!res.ok) throw new Error(`data.json fetch failed: ${res.status}`);
  const data: DataJson = await res.json();
  const map: Record<string, MatchMeta> = {};
  for (const list of Object.values(data.group_matches ?? {})) {
    for (const m of list) map[m.id] = { team1: m.team1, team2: m.team2 };
  }
  for (const m of data.ko_matches ?? []) {
    map[m.id] = { team1: m.team1, team2: m.team2 };
  }
  return map;
}

function matchLabel(matchId: string, meta: Record<string, MatchMeta>): string {
  const m = meta[matchId];
  if (!m) return matchId; // Shouldn't happen, but degrade gracefully.
  // Group rounds: team names are real. KO before bracket fills: slot
  // tokens like "1A". prettySlot handles both — passes real names
  // through unchanged.
  return `${prettySlot(m.team1)} vs ${prettySlot(m.team2)}`;
}

/** Format kickoff in Berlin local time. The whole league is based
 *  there, so showing "Sat, 14 Jun, 21:00 CEST" reads more naturally
 *  than UTC and members don't have to do mental conversion. The IANA
 *  zone handles CET/CEST switchover automatically. */
function formatKickoff(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
    timeZoneName: 'short',
  });
}

function renderEmail(
  row: ReminderRow,
  appUrl: string,
  meta: Record<string, MatchMeta>,
): { subject: string; html: string; text: string } {
  const n = row.missing.length;
  const subject = `Reminder: ${n} prediction${n === 1 ? '' : 's'} due in the next 24h`;

  const list = row.missing
    .map(m => {
      const label = matchLabel(m.match_id, meta);
      const when = formatKickoff(m.kickoff_at);
      return `<li><strong>${escapeHtml(label)}</strong> — ${escapeHtml(when)}</li>`;
    })
    .join('');

  const textList = row.missing
    .map(m => `  • ${matchLabel(m.match_id, meta)} — ${formatKickoff(m.kickoff_at)}`)
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
  // 1. Auth.
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

  // 3. Load match metadata so we can render team names instead of IDs.
  const url = new URL(ctx.request.url);
  const host = `${url.protocol}//${url.host}`;
  let meta: Record<string, MatchMeta>;
  try {
    meta = await loadMatchMeta(host);
  } catch (e) {
    return Response.json({ error: `match-meta: ${(e as Error).message}` }, { status: 500 });
  }

  // 4. Send via Resend, in parallel but with a small concurrency cap so
  //    we don't get rate-limited on big days.
  const results = { sent: 0, failed: 0, errors: [] as string[] };
  const concurrency = 5;

  for (let i = 0; i < reminders.length; i += concurrency) {
    const slice = reminders.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async (row) => {
        const { subject, html, text } = renderEmail(row, ctx.env.APP_URL, meta);
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

  // 5. Send push notifications to users with subscriptions
  //    (fire-and-forget — don't block the response on push delivery)
  const pushUrl = `${url.protocol}//${url.host}/send-push`;
  for (const row of reminders) {
    const n = row.missing.length;
    // Look up user_id by email from profiles
    const profileRes = await fetch(
      `${ctx.env.SUPABASE_URL}/rest/v1/wc26_profiles?select=user_id&email=eq.${encodeURIComponent(row.email)}&limit=1`,
      {
        headers: {
          apikey: ctx.env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${ctx.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    if (profileRes.ok) {
      const profiles: Array<{ user_id: string }> = await profileRes.json();
      if (profiles.length > 0) {
        fetch(pushUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-wc26-secret': ctx.env.WC26_WEBHOOK_SECRET,
          },
          body: JSON.stringify({
            userIds: [profiles[0].user_id],
            title: `${n} pick${n === 1 ? '' : 's'} needed!`,
            body: `You have ${n} match${n === 1 ? '' : 'es'} to predict today`,
            url: '/',
          }),
        }).catch(() => {}); // fire-and-forget
      }
    }
  }

  return Response.json(results);
};
