/**
 * Cloudflare Pages Function: pulled by pg_cron every few minutes to
 * fetch match status from football-data.org and sync into
 * wc26_match_results. Admin-entered rows (source='admin') are never
 * overwritten — the league's official scoreboard stays under admin
 * control.
 *
 * Endpoint: POST https://<host>/sync-matches
 * Auth:     x-wc26-secret header (shared with pg_cron, same secret as
 *           /notify-signup and /send-reminders)
 *
 * Required env vars (Cloudflare Pages → Settings → Env vars):
 *   FOOTBALL_DATA_API_KEY       — football-data.org X-Auth-Token
 *   SUPABASE_URL                — your project URL
 *   SUPABASE_SERVICE_ROLE_KEY   — bypasses RLS (encrypted, secret)
 *   WC26_WEBHOOK_SECRET         — shared with pg_cron
 *
 * Response: { upserted, skipped_admin, skipped_no_score, errors }
 */

interface Env {
  FOOTBALL_DATA_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WC26_WEBHOOK_SECRET: string;
}

interface FdScore {
  winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
  duration: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT' | null;
  fullTime?: { home: number | null; away: number | null };
  halfTime?: { home: number | null; away: number | null };
}

interface FdMatch {
  id: number;
  utcDate: string;
  status: string; // SCHEDULED | LIVE | IN_PLAY | PAUSED | FINISHED | …
  stage?: string;
  group?: string;
  matchday?: number;
  venue?: string | null;
  homeTeam: { id: number; name: string; tla?: string; crest?: string };
  awayTeam: { id: number; name: string; tla?: string; crest?: string };
  score: FdScore;
  referees?: Array<{ id: number; name: string; type: string; nationality?: string }>;
}

interface FdMatchesResponse {
  matches?: FdMatch[];
}

interface MatchMapEntry {
  fd_id: number;
  home: string;
  away: string;
  date: string;
  /** False → FD's home team is OUR team2. Flip scores when upserting. */
  same_order_as_fd: boolean;
}
type MatchMap = Record<string, MatchMapEntry>; // our_id → entry

interface ExistingResultRow {
  match_id: string;
  source: 'admin' | 'api';
}

interface UpsertRow {
  match_id: string;
  team1_score: number;
  team2_score: number;
  advancer: string | null;
  source: 'api';
  payload: FdMatch;
}

const FD_ENDPOINT = 'https://api.football-data.org/v4/competitions/WC/matches';

/**
 * Decide who advances on a knockout match. football-data.org's
 * `score.winner` is HOME_TEAM/AWAY_TEAM/DRAW based on the *full match*
 * (including ET and pens), so it's the right field to source the
 * advancer from. Returns null for non-KO matches and matches still in
 * progress.
 */
function deriveAdvancer(m: FdMatch): string | null {
  if (m.stage === 'GROUP_STAGE') return null;
  if (m.score.winner === 'HOME_TEAM') return m.homeTeam.name;
  if (m.score.winner === 'AWAY_TEAM') return m.awayTeam.name;
  return null;
}

function shouldUpsert(m: FdMatch): boolean {
  // Only sync matches that have a usable score. Anything still SCHEDULED
  // / TIMED has fullTime null,null — skip.
  const ft = m.score.fullTime;
  return !!ft && ft.home !== null && ft.away !== null && Number.isFinite(ft.home) && Number.isFinite(ft.away);
}

async function loadMatchMap(host: string): Promise<MatchMap> {
  // Fetch the static asset bundled into the deploy. Cloudflare's CDN
  // serves it without hitting our Functions runtime budget.
  const res = await fetch(`${host}/data/fd-match-map.json`);
  if (!res.ok) throw new Error(`fd-match-map.json fetch failed: ${res.status}`);
  return res.json();
}

async function fetchFdMatches(apiKey: string): Promise<FdMatch[]> {
  const res = await fetch(FD_ENDPOINT, {
    headers: { 'X-Auth-Token': apiKey },
  });
  if (!res.ok) throw new Error(`football-data.org ${res.status}: ${await res.text()}`);
  const body: FdMatchesResponse = await res.json();
  return body.matches ?? [];
}

async function fetchExistingResults(env: Env): Promise<Record<string, ExistingResultRow>> {
  // service-role key bypasses RLS so we see all rows regardless of who
  // wrote them.
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/wc26_match_results?select=match_id,source`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!res.ok) throw new Error(`supabase select failed ${res.status}: ${await res.text()}`);
  const rows: ExistingResultRow[] = await res.json();
  const out: Record<string, ExistingResultRow> = {};
  for (const r of rows) out[r.match_id] = r;
  return out;
}

async function upsertResults(env: Env, rows: UpsertRow[]): Promise<{ ok: number; errors: string[] }> {
  if (rows.length === 0) return { ok: 0, errors: [] };
  // Use Postgrest upsert with on-conflict=match_id. Resolution=merge-duplicates
  // makes Postgrest do the UPSERT for us. We send all rows in one request.
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/wc26_match_results?on_conflict=match_id`,
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) {
    return { ok: 0, errors: [`supabase upsert ${res.status}: ${await res.text()}`] };
  }
  return { ok: rows.length, errors: [] };
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  // Auth.
  const secret = ctx.request.headers.get('x-wc26-secret') ?? '';
  if (!ctx.env.WC26_WEBHOOK_SECRET || secret !== ctx.env.WC26_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  // Sanity-check env. Surfacing this early gives a clear error in the
  // pg_net response, instead of an opaque 500 deep in the pipeline.
  for (const k of ['FOOTBALL_DATA_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const) {
    if (!ctx.env[k]) {
      return Response.json(
        { error: `missing env var: ${k}` },
        { status: 500 },
      );
    }
  }

  const url = new URL(ctx.request.url);
  const host = `${url.protocol}//${url.host}`;

  let matchMap: MatchMap;
  try {
    matchMap = await loadMatchMap(host);
  } catch (e) {
    return Response.json({ error: `match-map: ${(e as Error).message}` }, { status: 500 });
  }
  // Build reverse index: fd_id → our match_id
  const fdToOurs: Record<number, string> = {};
  for (const [ourId, entry] of Object.entries(matchMap)) fdToOurs[entry.fd_id] = ourId;

  let fdMatches: FdMatch[];
  try {
    fdMatches = await fetchFdMatches(ctx.env.FOOTBALL_DATA_API_KEY);
  } catch (e) {
    return Response.json({ error: `fd: ${(e as Error).message}` }, { status: 502 });
  }

  let existing: Record<string, ExistingResultRow>;
  try {
    existing = await fetchExistingResults(ctx.env);
  } catch (e) {
    return Response.json({ error: `supabase: ${(e as Error).message}` }, { status: 502 });
  }

  const toUpsert: UpsertRow[] = [];
  let skipped_admin = 0;
  let skipped_no_score = 0;
  let skipped_unmapped = 0;

  for (const m of fdMatches) {
    const ourId = fdToOurs[m.id];
    if (!ourId) {
      // Likely a KO match whose slot tokens we haven't re-mapped yet.
      skipped_unmapped++;
      continue;
    }
    if (!shouldUpsert(m)) {
      skipped_no_score++;
      continue;
    }
    const ex = existing[ourId];
    if (ex && ex.source === 'admin') {
      // Admin always wins. Don't touch.
      skipped_admin++;
      continue;
    }
    const sameOrder = matchMap[ourId].same_order_as_fd;
    const fdHome = m.score.fullTime!.home as number;
    const fdAway = m.score.fullTime!.away as number;
    toUpsert.push({
      match_id: ourId,
      team1_score: sameOrder ? fdHome : fdAway,
      team2_score: sameOrder ? fdAway : fdHome,
      advancer: deriveAdvancer(m),
      source: 'api',
      payload: m,
    });
  }

  const { ok, errors } = await upsertResults(ctx.env, toUpsert);

  return Response.json({
    upserted: ok,
    skipped_admin,
    skipped_no_score,
    skipped_unmapped,
    fd_total: fdMatches.length,
    errors,
  });
};
