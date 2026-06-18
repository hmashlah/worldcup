/**
 * Cloudflare Pages Function: pulled by pg_cron every few minutes to
 * fetch match status from football-data.org and sync into
 * wc26_match_results. Admin-entered rows (source='admin') are never
 * overwritten — the league's official scoreboard stays under admin
 * control.
 *
 * Also handles wiki scorer syncing: after processing FD matches, if
 * there are any matches that need scorers (newly finished or stale
 * goal-count mismatch), it fetches the Wikipedia article and patches
 * wiki_scorers. This avoids a separate cron job and only hits Wikipedia
 * when there's actual work to do.
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
 * Response: { upserted, skipped_admin, skipped_no_score, errors, wiki: {...} }
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
  /** ISO timestamp of FD's last edit to this match record. We use it as
   *  a cheap change-detector for admin-row payload enrichment. */
  lastUpdated?: string;
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
  /** True if the row already has a payload column populated. Once true,
   *  we never re-fetch or re-write this row — finished match data is
   *  inert. */
  has_payload: boolean;
}

// ── Wiki scorer types & helpers ──────────────────────────────────────

interface WikiGoal {
  team: 'home' | 'away';
  name: string;
  minute: number;
  extraTime?: number;
  kind: 'goal' | 'penalty' | 'own-goal';
}

interface WikiMatch {
  date: string;
  home: string;
  away: string;
  home_score: number;
  away_score: number;
  goals: WikiGoal[];
}

interface WikiSyncState {
  match_id: string;
  team1_score: number;
  team2_score: number;
  wiki_scorer_count: number; // -1 if null
  is_finished: boolean;
}

interface UpsertRow {
  match_id: string;
  team1_score: number;
  team2_score: number;
  advancer: string | null;
  source: 'api';
  payload: FdMatch;
}

/** Update sent for admin-entered rows: enrich the payload without
 *  touching the score or source columns. Postgrest's PATCH lets us
 *  update a single column when filtered by primary key. */
interface PayloadOnlyPatch {
  payload: FdMatch;
}

const FD_ENDPOINT = 'https://api.football-data.org/v4/competitions/WC/matches';

/** FD statuses for matches currently in progress. We mirror these into
 *  wc26_match_live so the UI can render a live score. Anything else
 *  (SCHEDULED, TIMED, FINISHED, POSTPONED…) means there's no live state
 *  worth showing — for FINISHED we use wc26_match_results instead. */
const LIVE_STATUSES = new Set(['IN_PLAY', 'LIVE', 'PAUSED']);
const isLive = (m: FdMatch) => LIVE_STATUSES.has(m.status);

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
  // Only sync matches FD has marked as fully finished. FD populates
  // `score.fullTime` LIVE while a match is in progress (so a 0-1 in the
  // 30th minute would otherwise look final to us), so checking the
  // status field is essential. Any other status (SCHEDULED, TIMED,
  // IN_PLAY, PAUSED, LIVE, SUSPENDED, POSTPONED, CANCELLED, AWARDED)
  // is ignored — admin can still type in a forfeited / awarded result
  // manually.
  if (m.status !== 'FINISHED') return false;
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
  // wrote them. We do TWO cheap selects:
  //   1. match_id + source (negligible bytes, ~30b/row)
  //   2. match_ids where payload is null (admin rows still needing
  //      enrichment) — typically a tiny subset.
  // Avoiding the full payload column saves ~1.5 KB/row × 100+ rows on
  // every cron tick — the dominant egress + IO cost when growing toward
  // tournament end.
  const baseRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/wc26_match_results?select=match_id,source`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!baseRes.ok) throw new Error(`supabase base select ${baseRes.status}: ${await baseRes.text()}`);
  const baseRows: Array<{ match_id: string; source: 'admin' | 'api' }> = await baseRes.json();

  // Which match_ids still need their payload populated?
  const nullPayloadRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/wc26_match_results?select=match_id&payload=is.null`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!nullPayloadRes.ok) throw new Error(`supabase null-payload select ${nullPayloadRes.status}: ${await nullPayloadRes.text()}`);
  const nullPayloadIds: Set<string> = new Set(
    ((await nullPayloadRes.json()) as Array<{ match_id: string }>).map(r => r.match_id),
  );

  const out: Record<string, ExistingResultRow> = {};
  for (const r of baseRows) {
    out[r.match_id] = {
      match_id: r.match_id,
      source: r.source,
      has_payload: !nullPayloadIds.has(r.match_id),
    };
  }
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

/**
 * Enrich an admin-entered row with the API payload, leaving every other
 * column (scores, advancer, source) untouched. We can't include this in
 * the bulk upsert because that would set source='api' and bump the
 * scores. PATCH per row is fine since this only fires for the handful
 * of matches admin has manually entered.
 */
async function patchPayloads(
  env: Env,
  patches: Array<{ match_id: string; patch: PayloadOnlyPatch }>,
): Promise<{ ok: number; errors: string[] }> {
  if (patches.length === 0) return { ok: 0, errors: [] };
  const errors: string[] = [];
  let ok = 0;
  // Sequential to keep the code simple; admin entries are rare.
  for (const { match_id, patch } of patches) {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/wc26_match_results?match_id=eq.${encodeURIComponent(match_id)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'content-type': 'application/json',
          prefer: 'return=minimal',
        },
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) {
      errors.push(`supabase patch ${match_id}: ${res.status} ${await res.text()}`);
    } else {
      ok++;
    }
  }
  return { ok, errors };
}

async function upsertLive(
  env: Env,
  rows: Array<{ match_id: string; payload: FdMatch }>,
): Promise<{ ok: number; errors: string[] }> {
  if (rows.length === 0) return { ok: 0, errors: [] };
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/wc26_match_live?on_conflict=match_id`,
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
  if (!res.ok) return { ok: 0, errors: [`live upsert ${res.status}: ${await res.text()}`] };
  return { ok: rows.length, errors: [] };
}

async function deleteLiveRows(
  env: Env,
  matchIds: string[],
): Promise<{ ok: number; errors: string[] }> {
  if (matchIds.length === 0) return { ok: 0, errors: [] };
  // Postgrest accepts an `in` filter on the primary key for batch deletes.
  const inList = matchIds.map(encodeURIComponent).join(',');
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/wc26_match_live?match_id=in.(${inList})`,
    {
      method: 'DELETE',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        prefer: 'return=minimal',
      },
    },
  );
  if (!res.ok) return { ok: 0, errors: [`live delete ${res.status}: ${await res.text()}`] };
  return { ok: matchIds.length, errors: [] };
}

async function fetchExistingLiveIds(env: Env): Promise<string[]> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/wc26_match_live?select=match_id`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!res.ok) throw new Error(`supabase live select ${res.status}: ${await res.text()}`);
  const rows: Array<{ match_id: string }> = await res.json();
  return rows.map(r => r.match_id);
}

// ── Wiki scorer sync helpers ─────────────────────────────────────────

const WIKI_TEAM_ALIASES: Record<string, string> = {
  'United States': 'USA',
  'Czechia': 'Czech Republic',
  'Bosnia-Herzegovina': 'Bosnia & Herzegovina',
  'Bosnia and Herzegovina': 'Bosnia & Herzegovina',
  'Cape Verde Islands': 'Cape Verde',
  'Congo DR': 'DR Congo',
};

function canonicalizeTeam(wikiTitle: string): string {
  const name = wikiTitle
    .replace(/\s+(?:men[''']s\s+)?national\s+(football|soccer)\s+team$/i, '')
    .trim();
  return WIKI_TEAM_ALIASES[name] ?? name;
}

const htmlDecode = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#160;/g, ' ').replace(/&nbsp;/g, ' ');

function parseFootballboxes(html: string): WikiMatch[] {
  const boxes = html.match(/<div [^>]*class="footballbox"[^>]*>[\s\S]*?<\/table>/g) ?? [];
  const out: WikiMatch[] = [];
  for (const b of boxes) {
    const dateM = b.match(/class="bday[^"]*">(\d{4}-\d{2}-\d{2})/);
    if (!dateM) continue;
    const date = dateM[1];
    const homeM = b.match(/class="fhome"[\s\S]*?title="([^"]+)"/);
    const awayM = b.match(/class="faway"[\s\S]*?title="([^"]+)"/);
    if (!homeM || !awayM) continue;
    const home = canonicalizeTeam(htmlDecode(homeM[1]));
    const away = canonicalizeTeam(htmlDecode(awayM[1]));
    const scoreM = b.match(/class="fscore"[^>]*>(?:<a[^>]*>)?\s*(\d+)\s*[–-]\s*(\d+)/);
    if (!scoreM) continue;
    const home_score = parseInt(scoreM[1], 10);
    const away_score = parseInt(scoreM[2], 10);
    const homeGoalsBlock = b.match(/class="fhgoal"[\s\S]*?<\/td>/)?.[0] ?? '';
    const awayGoalsBlock = b.match(/class="fagoal"[\s\S]*?<\/td>/)?.[0] ?? '';
    const goals: WikiGoal[] = [
      ...parseGoalsBlock(homeGoalsBlock, 'home'),
      ...parseGoalsBlock(awayGoalsBlock, 'away'),
    ];
    goals.sort((a, b) => {
      const am = a.minute + (a.extraTime ?? 0) / 100;
      const bm = b.minute + (b.extraTime ?? 0) / 100;
      return am - bm;
    });
    out.push({ date, home, away, home_score, away_score, goals });
  }
  return out;
}

function parseGoalsBlock(block: string, team: 'home' | 'away'): WikiGoal[] {
  const out: WikiGoal[] = [];
  const liMatches = block.matchAll(/<li>([\s\S]*?)<\/li>/g);
  for (const m of liMatches) {
    const li = m[1];
    const nameM = li.match(/<a[^>]*title="([^"]+)"/);
    const displayM = li.match(/<a[^>]*>([^<]+)</);
    const rawName = htmlDecode((nameM?.[1] ?? displayM?.[1] ?? '').trim());
    if (!rawName) continue;
    const name = rawName.replace(/\s*\([^)]*\)\s*$/, '');
    const minuteHits = [...li.matchAll(/(\d+)(?:\+(\d+))?\s*'/g)];
    if (minuteHits.length === 0) continue;
    const isPen = /\(\s*pen\.?\s*\)/i.test(li);
    const isOG = /\(\s*o\.?\s*g\.?\s*\)/i.test(li);
    const kind: WikiGoal['kind'] = isPen ? 'penalty' : isOG ? 'own-goal' : 'goal';
    for (const h of minuteHits) {
      const minute = parseInt(h[1], 10);
      const extraTime = h[2] ? parseInt(h[2], 10) : undefined;
      if (minute < 1 || minute > 130) continue;
      const g: WikiGoal = { team, name, minute, kind };
      if (extraTime !== undefined) g.extraTime = extraTime;
      out.push(g);
    }
  }
  return out;
}

async function fetchWikiHtml(): Promise<string> {
  const res = await fetch('https://en.wikipedia.org/wiki/2026_FIFA_World_Cup', {
    headers: {
      'User-Agent': 'wc26-prediction-league/1.0 (https://worldcup-1jo.pages.dev; admin@simple-courses.com) scorer-sync',
    },
  });
  if (!res.ok) throw new Error(`wikipedia ${res.status}: ${await res.text()}`);
  return res.text();
}

/** Fetch the wiki_scorers state for all matches that have results. */
async function fetchWikiSyncState(env: Env): Promise<WikiSyncState[]> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/wc26_match_results?select=match_id,team1_score,team2_score,wiki_scorers,payload`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!res.ok) throw new Error(`supabase wiki-state ${res.status}: ${await res.text()}`);
  const rows: Array<{
    match_id: string;
    team1_score: number;
    team2_score: number;
    wiki_scorers: WikiGoal[] | null;
    payload: { status?: string } | null;
  }> = await res.json();

  return rows.map(r => ({
    match_id: r.match_id,
    team1_score: r.team1_score,
    team2_score: r.team2_score,
    wiki_scorer_count: Array.isArray(r.wiki_scorers) ? r.wiki_scorers.length : -1,
    is_finished: r.payload?.status === 'FINISHED',
  }));
}

async function patchWikiScorers(
  env: Env,
  match_id: string,
  goals: WikiGoal[],
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/wc26_match_results?match_id=eq.${encodeURIComponent(match_id)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify({ wiki_scorers: goals }),
    },
  );
  if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
  return { ok: true };
}

/**
 * For live matches: upsert a result row with the current score and
 * wiki scorers. The row has NO payload (or a minimal one with status
 * IN_PLAY), so the system knows it's not finalized. When the match
 * finishes, the normal FINISHED upsert overwrites this with the full
 * payload, correct final score, and source='api'.
 */
async function upsertLiveWikiScorers(
  env: Env,
  match_id: string,
  team1_score: number,
  team2_score: number,
  goals: WikiGoal[],
): Promise<{ ok: boolean; error?: string }> {
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
      body: JSON.stringify({
        match_id,
        team1_score,
        team2_score,
        source: 'api',
        wiki_scorers: goals,
        // No `payload` field — signals this is not yet final.
        // The FINISHED upsert later will add the full payload.
      }),
    },
  );
  if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
  return { ok: true };
}

function shiftDate(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

interface OurMatchInfo {
  match_id: string;
  date: string;
  team1: string;
  team2: string;
}

async function fetchOurMatches(host: string): Promise<OurMatchInfo[]> {
  const res = await fetch(`${host}/data.json`);
  if (!res.ok) throw new Error(`data.json ${res.status}`);
  type DJMatch = { id: string; team1: string; team2: string; date: string };
  const data: {
    group_matches: Record<string, DJMatch[]>;
    ko_matches: DJMatch[];
  } = await res.json();
  const out: OurMatchInfo[] = [];
  for (const list of Object.values(data.group_matches)) {
    for (const m of list) out.push({ match_id: m.id, date: m.date, team1: m.team1, team2: m.team2 });
  }
  for (const m of data.ko_matches) out.push({ match_id: m.id, date: m.date, team1: m.team1, team2: m.team2 });
  return out;
}

/**
 * Determine which matches need wiki scorer syncing and perform it.
 * Only fetches Wikipedia if there's actual work to do.
 *
 * Triggers for wiki sync:
 * 1. Live match: current score (team1+team2) > stored wiki_scorer_count
 *    (a new goal was scored and wikipedia might have it)
 * 2. Finished match: no wiki_scorers yet (newly finished)
 * 3. Finished match: wiki_scorer_count != actual total goals (stale data)
 */
async function syncWikiScorers(
  env: Env,
  host: string,
  liveMatches: Array<{ match_id: string; payload: FdMatch }>,
  matchMap: MatchMap,
): Promise<{ needed: boolean; fetched: boolean; updated: number; errors: string[] }> {
  // Fetch current state from DB
  let syncState: WikiSyncState[];
  try {
    syncState = await fetchWikiSyncState(env);
  } catch (e) {
    return { needed: false, fetched: false, updated: 0, errors: [(e as Error).message] };
  }

  const stateByMatch = new Map(syncState.map(s => [s.match_id, s]));

  // Check live matches — do any have a score mismatch with stored scorers?
  const liveNeedSync: string[] = [];
  for (const lm of liveMatches) {
    const ourId = lm.match_id;
    const state = stateByMatch.get(ourId);
    // For live matches, we compare against the live score from FD
    const ft = lm.payload.score?.fullTime;
    if (!ft || ft.home === null || ft.away === null) continue;
    const liveTotal = (ft.home ?? 0) + (ft.away ?? 0);
    const storedCount = state?.wiki_scorer_count ?? -1;
    // Need sync if: has goals but scorers are missing or don't match
    if (liveTotal > 0 && storedCount !== liveTotal) {
      liveNeedSync.push(ourId);
    }
  }

  // Check finished matches — any missing or mismatched scorers?
  const finishedNeedSync: string[] = [];
  for (const s of syncState) {
    if (!s.is_finished) continue;
    const totalGoals = s.team1_score + s.team2_score;
    if (totalGoals === 0) continue; // 0-0 draws have nothing to scrape
    if (s.wiki_scorer_count === totalGoals) continue; // already correct
    finishedNeedSync.push(s.match_id);
  }

  const allNeedSync = new Set([...liveNeedSync, ...finishedNeedSync]);
  if (allNeedSync.size === 0) {
    return { needed: false, fetched: false, updated: 0, errors: [] };
  }

  // There's work to do — fetch Wikipedia and our match list
  let html: string;
  let ourMatches: OurMatchInfo[];
  try {
    [html, ourMatches] = await Promise.all([
      fetchWikiHtml(),
      fetchOurMatches(host),
    ]);
  } catch (e) {
    return { needed: true, fetched: false, updated: 0, errors: [(e as Error).message] };
  }

  // Parse Wikipedia
  const wikiMatches = parseFootballboxes(html);
  const wikiByKey = new Map<string, WikiMatch>();
  for (const w of wikiMatches) {
    const pair = [w.home, w.away].sort().join('|');
    wikiByKey.set(`${w.date}|${pair}`, w);
  }

  // Match and patch
  const errors: string[] = [];
  let updated = 0;

  // Build a lookup of live match scores for upsert
  const liveScoreByMatch = new Map<string, { team1: number; team2: number }>();
  for (const lm of liveMatches) {
    const ft = lm.payload.score?.fullTime;
    if (!ft || ft.home === null || ft.away === null) continue;
    const sameOrder = matchMap[lm.match_id]?.same_order_as_fd ?? true;
    liveScoreByMatch.set(lm.match_id, {
      team1: sameOrder ? ft.home! : ft.away!,
      team2: sameOrder ? ft.away! : ft.home!,
    });
  }

  const liveNeedSyncSet = new Set(liveNeedSync);

  for (const our of ourMatches) {
    if (!allNeedSync.has(our.match_id)) continue;

    const pair = [canonicalizeTeam(our.team1), canonicalizeTeam(our.team2)].sort().join('|');
    const candidates = [
      `${our.date}|${pair}`,
      `${shiftDate(our.date, +1)}|${pair}`,
      `${shiftDate(our.date, -1)}|${pair}`,
    ];
    let w: WikiMatch | undefined;
    for (const k of candidates) {
      const hit = wikiByKey.get(k);
      if (hit) { w = hit; break; }
    }
    if (!w) continue;

    // Flip home/away if needed
    const ourTeam1 = canonicalizeTeam(our.team1);
    const flipped = w.home !== ourTeam1;
    const goals: WikiGoal[] = w.goals.map(g => ({
      ...g,
      team: flipped ? (g.team === 'home' ? 'away' : 'home') : g.team,
    }));

    // Don't write empty arrays
    if (goals.length === 0) continue;

    // For live matches, upsert a result row with current score + scorers.
    // This ensures the UI can show scorers during play. The row will be
    // overwritten with the full FINISHED payload once the match ends.
    if (liveNeedSyncSet.has(our.match_id)) {
      const liveScore = liveScoreByMatch.get(our.match_id);
      if (liveScore) {
        const r = await upsertLiveWikiScorers(env, our.match_id, liveScore.team1, liveScore.team2, goals);
        if (r.ok) updated++;
        else errors.push(`wiki ${our.match_id}: ${r.error}`);
        continue;
      }
    }

    const r = await patchWikiScorers(env, our.match_id, goals);
    if (r.ok) updated++;
    else errors.push(`wiki ${our.match_id}: ${r.error}`);
  }

  return { needed: true, fetched: true, updated, errors };
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

  let existingLiveIds: string[];
  try {
    existingLiveIds = await fetchExistingLiveIds(ctx.env);
  } catch (e) {
    return Response.json({ error: `supabase live: ${(e as Error).message}` }, { status: 502 });
  }

  const toUpsert: UpsertRow[] = [];
  const toPatch: Array<{ match_id: string; patch: PayloadOnlyPatch }> = [];
  const toLiveUpsert: Array<{ match_id: string; payload: FdMatch }> = [];
  const stillLiveIds = new Set<string>();
  let skipped_already_synced = 0;
  let skipped_no_score = 0;
  let skipped_unmapped = 0;

  for (const m of fdMatches) {
    const ourId = fdToOurs[m.id];
    if (!ourId) {
      skipped_unmapped++;
      continue;
    }

    // Live branch — match in progress. Mirror into wc26_match_live.
    // Note: live rows live alongside (possibly absent) wc26_match_results
    // rows. The UI joins them.
    if (isLive(m)) {
      toLiveUpsert.push({ match_id: ourId, payload: m });
      stillLiveIds.add(ourId);
      // Don't touch wc26_match_results during live play.
      continue;
    }

    if (!shouldUpsert(m)) {
      skipped_no_score++;
      continue;
    }

    const ex = existing[ourId];

    // Already-synced FINISHED match: row exists AND its payload is
    // populated. Nothing to do — finished match data is inert. This is
    // the dominant case across most cron ticks and the biggest source
    // of disk IO if we don't gate it.
    if (ex && ex.has_payload) {
      skipped_already_synced++;
      continue;
    }

    if (ex && ex.source === 'admin') {
      // Admin owns the score — never overwrite. But the row has no
      // payload yet (otherwise we'd have skipped above), so do a
      // one-time payload enrichment so the detail page can show
      // half-time / referee / etc.
      toPatch.push({ match_id: ourId, patch: { payload: m } });
      continue;
    }

    // No existing row — upsert the FINISHED data.
    const sameOrder = matchMap[ourId].same_order_as_fd;
    const entry = matchMap[ourId];
    const fdHome = m.score.fullTime!.home as number;
    const fdAway = m.score.fullTime!.away as number;
    // Map FD advancer name to our canonical team name.
    const fdAdvancer = deriveAdvancer(m);
    let advancer: string | null = null;
    if (fdAdvancer === m.homeTeam.name) {
      advancer = sameOrder ? entry.home : entry.away;
    } else if (fdAdvancer === m.awayTeam.name) {
      advancer = sameOrder ? entry.away : entry.home;
    }
    toUpsert.push({
      match_id: ourId,
      team1_score: sameOrder ? fdHome : fdAway,
      team2_score: sameOrder ? fdAway : fdHome,
      advancer,
      source: 'api',
      payload: m,
    });
  }

  // Any wc26_match_live row that's no longer live (match finished, was
  // postponed, etc.) gets deleted so we don't show stale "live" state.
  const toLiveDelete = existingLiveIds.filter(id => !stillLiveIds.has(id));

  const upsertRes = await upsertResults(ctx.env, toUpsert);
  const patchRes = await patchPayloads(ctx.env, toPatch);
  const liveUpsertRes = await upsertLive(ctx.env, toLiveUpsert);
  const liveDeleteRes = await deleteLiveRows(ctx.env, toLiveDelete);

  // ── Wiki scorer sync ──────────────────────────────────────────────
  // Piggybacks on this same cron tick. Only fetches Wikipedia if there
  // are live matches with new goals or finished matches needing scorers.
  const wikiRes = await syncWikiScorers(ctx.env, host, toLiveUpsert, matchMap);

  return Response.json({
    upserted: upsertRes.ok,
    admin_payload_enriched: patchRes.ok,
    live_upserted: liveUpsertRes.ok,
    live_deleted: liveDeleteRes.ok,
    skipped_already_synced,
    skipped_no_score,
    skipped_unmapped,
    fd_total: fdMatches.length,
    wiki: {
      needed: wikiRes.needed,
      fetched: wikiRes.fetched,
      updated: wikiRes.updated,
    },
    errors: [
      ...upsertRes.errors,
      ...patchRes.errors,
      ...liveUpsertRes.errors,
      ...liveDeleteRes.errors,
      ...wikiRes.errors,
    ],
  });
};
