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

/** Fetch the wiki_scorers state for all matches that have results. */
async function fetchScorerSyncState(env: Env): Promise<WikiSyncState[]> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/wc26_match_results?select=match_id,team1_score,team2_score,wiki_scorers,payload`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!res.ok) throw new Error(`supabase scorer-state ${res.status}: ${await res.text()}`);
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

async function patchScorers(
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
 * Sync goal scorers from Wikipedia. Only fetches when there are finished
 * matches with missing or stale scorer data.
 *
 * Triggers:
 * 1. Finished match: no scorers yet
 * 2. Finished match: scorer count != actual total goals
 *
 * Live matches are NOT handled here — the live score comes from
 * wc26_match_live (FD). Scorers only get written once Wikipedia has them.
 */
async function syncGoalScorers(
  env: Env,
  host: string,
): Promise<{ needed: boolean; fetched: boolean; updated: number; errors: string[] }> {
  // Fetch current state from DB
  let syncState: WikiSyncState[];
  try {
    syncState = await fetchScorerSyncState(env);
  } catch (e) {
    return { needed: false, fetched: false, updated: 0, errors: [(e as Error).message] };
  }

  // Check finished matches — any missing or mismatched scorers?
  const finishedNeedSync: string[] = [];
  for (const s of syncState) {
    if (!s.is_finished) continue;
    const totalGoals = s.team1_score + s.team2_score;
    if (totalGoals === 0) continue;
    if (s.wiki_scorer_count === totalGoals) continue;
    finishedNeedSync.push(s.match_id);
  }

  if (finishedNeedSync.length === 0) {
    return { needed: false, fetched: false, updated: 0, errors: [] };
  }

  // Fetch Wikipedia HTML and our match list in parallel
  let wikiHtml = '';
  let ourMatches: OurMatchInfo[];
  const fetchErrors: string[] = [];
  try {
    const results = await Promise.allSettled([
      fetchWikiHtml(),
      fetchOurMatches(host),
    ]);
    if (results[0].status === 'fulfilled') wikiHtml = results[0].value;
    else fetchErrors.push(`wikipedia: ${(results[0].reason as Error).message}`);
    if (results[1].status === 'rejected') {
      return { needed: true, fetched: false, updated: 0, errors: [`data.json: ${(results[1].reason as Error).message}`] };
    }
    ourMatches = results[1].value;
  } catch (e) {
    return { needed: true, fetched: false, updated: 0, errors: [(e as Error).message] };
  }

  if (!wikiHtml) {
    return { needed: true, fetched: false, updated: 0, errors: fetchErrors };
  }

  // Build Wikipedia lookup: (date|sorted team pair) → parsed goals
  const wikiByPair = new Map<string, WikiGoal[]>();
  const wikiMatches = parseFootballboxes(wikiHtml);
  for (const w of wikiMatches) {
    if (w.goals.length === 0) continue;
    const pair = [w.home, w.away].sort().join('|');
    wikiByPair.set(`${w.date}|${pair}`, w.goals);
  }

  // Match and patch
  const errors: string[] = [...fetchErrors];
  let updated = 0;
  const needSyncSet = new Set(finishedNeedSync);

  for (const our of ourMatches) {
    if (!needSyncSet.has(our.match_id)) continue;

    const pair = [our.team1, our.team2].sort().join('|');
    const dateShifts = [our.date, shiftDate(our.date, +1), shiftDate(our.date, -1)];

    let goals: WikiGoal[] | null = null;
    for (const d of dateShifts) {
      const wikiGoals = wikiByPair.get(`${d}|${pair}`);
      if (wikiGoals && wikiGoals.length > 0) {
        // Wiki goals need home/away flipping based on our team order
        const wikiHome = wikiGoals[0]?.team === 'home' ? our.team1 : our.team2;
        const flipped = wikiHome !== our.team1;
        goals = wikiGoals.map(g => ({
          ...g,
          team: flipped ? (g.team === 'home' ? 'away' : 'home') : g.team,
        }));
        break;
      }
    }

    if (!goals || goals.length === 0) continue; // Will retry next tick

    const r = await patchScorers(env, our.match_id, goals);
    if (r.ok) updated++;
    else errors.push(`scorers ${our.match_id}: ${r.error}`);
  }

  return { needed: true, fetched: true, updated, errors };
}

function shiftDate(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// ── Wikipedia scorer parsing ─────────────────────────────────────────

interface WikiParsedMatch {
  date: string;
  home: string;
  away: string;
  goals: WikiGoal[];
}

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

function parseFootballboxes(html: string): WikiParsedMatch[] {
  const boxes = html.match(/<div [^>]*class="footballbox"[^>]*>[\s\S]*?<\/table>/g) ?? [];
  const out: WikiParsedMatch[] = [];
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
    const homeGoalsBlock = b.match(/class="fhgoal"[\s\S]*?<\/td>/)?.[0] ?? '';
    const awayGoalsBlock = b.match(/class="fagoal"[\s\S]*?<\/td>/)?.[0] ?? '';
    const goals: WikiGoal[] = [
      ...parseGoalsBlock(homeGoalsBlock, 'home'),
      ...parseGoalsBlock(awayGoalsBlock, 'away'),
    ];
    goals.sort((a, b) => a.minute + ((a.extraTime ?? 0) / 100) - b.minute - ((b.extraTime ?? 0) / 100));
    out.push({ date, home, away, goals });
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

// ── Post-match enrichment (lineups, cards, subs, MOTM, etc.) ────────

interface MatchDetailGoal {
  team: 'home' | 'away';
  name: string;
  minute: number;
  extraTime?: number;
  kind: 'goal' | 'penalty' | 'own-goal';
}

interface MatchDetailPlayer {
  name: string;
  number?: number;
  position?: string;
  captain?: boolean;
}

interface MatchDetailSub {
  name: string;
  number?: number;
  minuteIn: number;
  replaced?: string;
}

interface MatchDetailCard {
  team: 'home' | 'away';
  name: string;
  minute: number;
  type: 'yellow' | 'red' | 'second-yellow';
}

interface MatchDetailLineups {
  home: { starting: MatchDetailPlayer[]; subs: MatchDetailSub[] };
  away: { starting: MatchDetailPlayer[]; subs: MatchDetailSub[] };
}

interface MatchDetailReferee {
  name: string;
  nationality?: string;
  assistants?: string[];
  var?: string;
}

interface MatchDetail {
  goals: MatchDetailGoal[];
  halfTime?: { home: number; away: number };
  attendance?: number;
  motm?: { name: string; team: 'home' | 'away' };
  referee?: MatchDetailReferee;
  lineups?: MatchDetailLineups;
  cards?: MatchDetailCard[];
  venue?: { stadium: string; city: string };
}

interface EnrichSyncState {
  match_id: string;
  payload: { status?: string } | null;
  match_detail: MatchDetail | null;
}

const WIKI_USER_AGENT = 'wc26-prediction-league/1.0 (https://worldcup-1jo.pages.dev; admin@simple-courses.com) match-detail-enrich';

async function fetchWikiGroupPage(group: string): Promise<string> {
  const url = `https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_Group_${group}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': WIKI_USER_AGENT },
  });
  if (!res.ok) throw new Error(`wiki group ${group} ${res.status}: ${await res.text()}`);
  return res.text();
}

function stripTags(html: string): string {
  return htmlDecode(html.replace(/<[^>]*>/g, '')).trim();
}

// ── Lineup parsing ───────────────────────────────────────────────────

interface ParsedLineup {
  starting: MatchDetailPlayer[];
  subs: MatchDetailSub[];
  cards: MatchDetailCard[];
  manager: string | null;
}

function parseLineupTable(tableHtml: string): ParsedLineup {
  const starting: MatchDetailPlayer[] = [];
  const subs: MatchDetailSub[] = [];
  const cards: MatchDetailCard[] = [];
  let manager: string | null = null;
  let inSubs = false;
  let inManager = false;

  const subbedOffMap: Record<string, number> = {};
  const rows = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];

  for (const row of rows) {
    if (/Substitutions/i.test(row) && /<b>/i.test(row)) {
      inSubs = true;
      inManager = false;
      continue;
    }
    if (/Manager/i.test(row) && /<b>/i.test(row)) {
      inManager = true;
      inSubs = false;
      continue;
    }

    if (inManager) {
      const manM = row.match(/<a[^>]*>([^<]+)<\/a>/) ?? row.match(/<td[^>]*>([^<]+)<\/td>/);
      if (manM) manager = htmlDecode(manM[1]).trim();
      continue;
    }

    const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? [];
    if (cells.length < 3) continue;

    const position = stripTags(cells[0]);
    const numberM = cells[1].match(/(\d+)/);
    if (!numberM) continue;
    const number = parseInt(numberM[1], 10);

    const nameCell = cells[2];
    const nameM = nameCell.match(/<a[^>]*(?:title="([^"]+)"[^>]*)?>([^<]*)<\/a>/);
    let name: string;
    if (nameM) {
      name = htmlDecode(nameM[2] || nameM[1] || '').trim();
      name = name.replace(/\s+(?:men[''']s\s+)?national\s+(?:football|soccer|association football)\s+team$/i, '').trim();
    } else {
      name = stripTags(nameCell);
    }
    if (!name || !position) continue;

    const captain = /\(c\)/.test(nameCell) || /\(captain\)/i.test(nameCell);

    let yellowCard: number | null = null;
    let redCard: number | null = null;
    let secondYellow: number | null = null;
    let subOff: number | null = null;
    let subOn: number | null = null;

    for (let i = 3; i < cells.length; i++) {
      const cell = cells[i];
      if (/Yellow_card/i.test(cell) || /title="Booked"/i.test(cell)) {
        const minM = cell.match(/(\d+)(?:\+(\d+))?\s*[''′']/);
        if (minM) yellowCard = parseInt(minM[1], 10);
        else {
          const minM2 = cell.match(/(?:Yellow_card[^>]*>|Booked[^>]*>)\s*(?:&#160;|&nbsp;|\s)*(\d+)/i);
          if (minM2) yellowCard = parseInt(minM2[1], 10);
        }
      }
      if (/Red_card/i.test(cell) || /title="Sent off"/i.test(cell)) {
        const minM = cell.match(/(\d+)(?:\+(\d+))?\s*[''′']/);
        if (minM) redCard = parseInt(minM[1], 10);
        else {
          const minM2 = cell.match(/(?:Red_card[^>]*>|Sent off[^>]*>)\s*(?:&#160;|&nbsp;|\s)*(\d+)/i);
          if (minM2) redCard = parseInt(minM2[1], 10);
        }
      }
      if (/Yellow-red_card/i.test(cell) || /title="Second yellow"/i.test(cell)) {
        const minM = cell.match(/(\d+)(?:\+(\d+))?\s*[''′']/);
        if (minM) secondYellow = parseInt(minM[1], 10);
      }
      if (/Sub_off/i.test(cell) || /title="Substituted off"/i.test(cell)) {
        const minM = cell.match(/(\d+)(?:\+(\d+))?\s*[''′']/);
        if (minM) subOff = parseInt(minM[1], 10);
        else {
          const minM2 = cell.match(/(?:Sub_off[^>]*>|Substituted off[^>]*>)\s*(?:&#160;|&nbsp;|\s)*(\d+)/i);
          if (minM2) subOff = parseInt(minM2[1], 10);
        }
      }
      if (/Sub_on/i.test(cell) || /title="Substituted on"/i.test(cell)) {
        const minM = cell.match(/(\d+)(?:\+(\d+))?\s*[''′']/);
        if (minM) subOn = parseInt(minM[1], 10);
        else {
          const minM2 = cell.match(/(?:Sub_on[^>]*>|Substituted on[^>]*>)\s*(?:&#160;|&nbsp;|\s)*(\d+)/i);
          if (minM2) subOn = parseInt(minM2[1], 10);
        }
      }
    }

    if (inSubs) {
      const sub: MatchDetailSub = { name, minuteIn: subOn ?? 0 };
      if (number) sub.number = number;
      subs.push(sub);
    } else {
      const player: MatchDetailPlayer = { name };
      if (number) player.number = number;
      if (position) player.position = position;
      if (captain) player.captain = true;
      starting.push(player);
      if (subOff !== null) subbedOffMap[name] = subOff;
    }

    // Cards — cast team later at call site
    if (yellowCard !== null) {
      cards.push({ team: 'home', name, minute: yellowCard, type: 'yellow' });
    }
    if (redCard !== null) {
      cards.push({ team: 'home', name, minute: redCard, type: 'red' });
    }
    if (secondYellow !== null) {
      cards.push({ team: 'home', name, minute: secondYellow, type: 'second-yellow' });
    }
  }

  // Link subs to replaced players
  for (const sub of subs) {
    const replaced = Object.entries(subbedOffMap).find(([_, min]) => min === sub.minuteIn);
    if (replaced) sub.replaced = replaced[0];
  }

  return { starting, subs, cards, manager };
}

// ── Footballbox meta (attendance, referee, venue) ────────────────────

interface FootballboxMeta {
  attendance: number | null;
  referee: { name: string; nationality: string } | null;
  venue: { stadium: string; city: string } | null;
}

function parseFootballboxMeta(box: string): FootballboxMeta {
  const meta: FootballboxMeta = { attendance: null, referee: null, venue: null };

  const frightM = box.match(/class="fright"[^>]*>([\s\S]*?)(?:<\/div>\s*){2,}/);
  if (frightM) {
    const frightContent = frightM[1];

    const venueM = frightContent.match(/itemprop="location"[^>]*>([\s\S]*?)<\/(?:div|span)>/);
    if (venueM) {
      const venueText = stripTags(venueM[1]);
      const parts = venueText.split(',').map(s => s.trim());
      if (parts.length >= 2) {
        meta.venue = { stadium: parts[0], city: parts.slice(1).join(', ') };
      } else {
        meta.venue = { stadium: venueText, city: '' };
      }
    }

    const attM = frightContent.match(/Attendance[:\s]*(?:<[^>]*>)*\s*([\d,]+)/i);
    if (attM) {
      meta.attendance = parseInt(attM[1].replace(/,/g, ''), 10);
    }

    const refM = frightContent.match(/Referee[:\s]*(?:<[^>]*>)*\s*(?:<a[^>]*>([^<]+)<\/a>|([^<(]+))\s*\((?:<a[^>]*>)?([^<)]+)/i);
    if (refM) {
      meta.referee = {
        name: htmlDecode(refM[1] || refM[2] || '').trim(),
        nationality: htmlDecode(refM[3] || '').trim(),
      };
    }
  }

  return meta;
}

// ── Parse goals from a footballbox section ───────────────────────────

function parseDetailGoalBlock(block: string, team: 'home' | 'away'): MatchDetailGoal[] {
  const out: MatchDetailGoal[] = [];
  const liMatches = block.matchAll(/<li>([\s\S]*?)<\/li>/g);
  for (const m of liMatches) {
    const li = m[1];
    const nameM = li.match(/<a[^>]*title="([^"]+)"/) ?? li.match(/<a[^>]*>([^<]+)</);
    if (!nameM) continue;
    const rawName = htmlDecode(nameM[1]).trim()
      .replace(/\s+(?:men[''']s\s+)?national\s+(?:football|soccer|association football)\s+team$/i, '')
      .replace(/\s*\([^)]*\)\s*$/, '');
    if (!rawName) continue;

    const isPen = /\(\s*pen\.?\s*\)/i.test(li);
    const isOG = /\(\s*o\.?\s*g\.?\s*\)/i.test(li);
    const kind: MatchDetailGoal['kind'] = isPen ? 'penalty' : isOG ? 'own-goal' : 'goal';

    const minuteHits = [...li.matchAll(/(\d+)(?:\+(\d+))?\s*[''′']/g)];
    for (const h of minuteHits) {
      const minute = parseInt(h[1], 10);
      const extraTime = h[2] ? parseInt(h[2], 10) : undefined;
      if (minute < 1 || minute > 130) continue;
      const g: MatchDetailGoal = { team, name: rawName, minute, kind };
      if (extraTime !== undefined) g.extraTime = extraTime;
      out.push(g);
    }
  }
  return out;
}

// ── Parse a full match section into MatchDetail ─────────────────────

function parseMatchDetailSection(
  section: string,
  targetHome: string,
  targetAway: string,
): MatchDetail | null {
  // Extract teams from footballbox
  const homeM = section.match(/class="fhome"[\s\S]*?title="([^"]+)"/);
  const awayM = section.match(/class="faway"[\s\S]*?title="([^"]+)"/);
  if (!homeM || !awayM) return null;

  const wikiHome = canonicalizeTeam(htmlDecode(homeM[1]));
  const wikiAway = canonicalizeTeam(htmlDecode(awayM[1]));

  // Verify this is the match we're looking for
  const pair = [targetHome, targetAway].sort().join('|');
  const wikiPair = [wikiHome, wikiAway].sort().join('|');
  if (pair !== wikiPair) return null;

  // Score check (must be finished)
  const scoreM = section.match(/class="fscore"[^>]*>(?:<a[^>]*>)?\s*(\d+)\s*[–-]\s*(\d+)/);
  if (!scoreM) return null;

  // Goals
  const homeGoalsBlock = section.match(/class="fhgoal"[\s\S]*?<\/td>/)?.[0] ?? '';
  const awayGoalsBlock = section.match(/class="fagoal"[\s\S]*?<\/td>/)?.[0] ?? '';

  // Determine if wiki's home is our team1 (targetHome)
  const flipped = wikiHome !== targetHome;
  const homeTeamLabel: 'home' | 'away' = flipped ? 'away' : 'home';
  const awayTeamLabel: 'home' | 'away' = flipped ? 'home' : 'away';

  const goals: MatchDetailGoal[] = [
    ...parseDetailGoalBlock(homeGoalsBlock, homeTeamLabel),
    ...parseDetailGoalBlock(awayGoalsBlock, awayTeamLabel),
  ].sort((a, b) => a.minute + ((a.extraTime ?? 0) / 100) - b.minute - ((b.extraTime ?? 0) / 100));

  // Meta (attendance, referee, venue)
  const meta = parseFootballboxMeta(section);

  // Lineup tables
  const lineupTables = section.match(/<table[^>]*style="[^"]*font-size:\s*90%[^"]*"[^>]*>[\s\S]*?<\/table>/gi) ?? [];

  let homeLineup: ParsedLineup | null = null;
  let awayLineup: ParsedLineup | null = null;

  if (lineupTables.length >= 2) {
    homeLineup = parseLineupTable(lineupTables[0]);
    awayLineup = parseLineupTable(lineupTables[1]);
  } else if (lineupTables.length === 1) {
    const wrapper = lineupTables[0];
    const tdCells = wrapper.match(/<td[^>]*valign="top"[^>]*>[\s\S]*?(?=<td[^>]*valign="top"|<\/tr>)/gi) ?? [];
    if (tdCells.length >= 2) {
      homeLineup = parseLineupTable(tdCells[0]);
      awayLineup = parseLineupTable(tdCells[1]);
    }
  }

  // Post-lineup: Man of the Match
  let motm: { name: string; team: 'home' | 'away' } | undefined;
  const motmM = section.match(/<b>Man of the Match:<\/b>[\s\S]*?<\/p>/i);
  if (motmM) {
    const motmBlock = motmM[0];
    const motmNameM = motmBlock.match(/<br\s*\/?>[\s\S]*?<a[^>]*(?:title="([^"]+)"[^>]*)?>([^<]*)<\/a>/);
    if (motmNameM) {
      const motmName = htmlDecode(motmNameM[2] || motmNameM[1] || '').trim();
      let motmTeam: 'home' | 'away' | null = null;
      if (homeLineup) {
        const inHome = homeLineup.starting.some(p => p.name === motmName) ||
                       homeLineup.subs.some(p => p.name === motmName);
        if (inHome) motmTeam = 'home';
      }
      if (!motmTeam && awayLineup) {
        const inAway = awayLineup.starting.some(p => p.name === motmName) ||
                       awayLineup.subs.some(p => p.name === motmName);
        if (inAway) motmTeam = 'away';
      }
      if (motmTeam) {
        // Remap based on our orientation
        const mappedTeam: 'home' | 'away' = motmTeam === 'home' ? homeTeamLabel : awayTeamLabel;
        motm = { name: motmName, team: mappedTeam };
      }
    }
  }

  // Officials: assistant referees, VAR
  const assistants: string[] = [];
  let varRef: string | undefined;
  const officialsM = section.match(/<p><b>[\s\S]*?Assistant referee[\s\S]*?<\/p>/i);
  if (officialsM) {
    const block = officialsM[0];
    const lines = block.split(/<br\s*\/?>/i);
    let currentSection = '';

    for (const line of lines) {
      const boldM = line.match(/<b>[\s\S]*?<\/b>/i);
      if (boldM) {
        const headerText = stripTags(boldM[0]).replace(/[:\s]+$/, '').trim().toLowerCase();
        if (/assistant referees?/i.test(headerText) && !/video/i.test(headerText) && !/reserve/i.test(headerText)) {
          currentSection = 'assistants';
        } else if (/^video assistant referee$/i.test(headerText)) {
          currentSection = 'var';
        } else {
          currentSection = headerText;
        }
        const afterBold = line.slice(line.indexOf(boldM[0]) + boldM[0].length);
        const nameInLine = stripTags(afterBold).replace(/\[\d+\]/g, '').replace(/&#91;\d+&#93;/g, '').trim();
        if (nameInLine && nameInLine.length > 2) {
          if (currentSection === 'assistants') assistants.push(nameInLine);
          else if (currentSection === 'var') varRef = nameInLine;
        }
        continue;
      }

      const text = stripTags(line).replace(/\[\d+\]/g, '').replace(/&#91;\d+&#93;/g, '').trim();
      if (!text || text.length <= 1) continue;

      if (currentSection === 'assistants') {
        assistants.push(text);
      } else if (currentSection === 'var' && !varRef) {
        varRef = text;
      }
    }
  }

  // Build cards array with correct team orientation
  const allCards: MatchDetailCard[] = [];
  if (homeLineup) {
    for (const c of homeLineup.cards) {
      allCards.push({ team: homeTeamLabel, name: c.name, minute: c.minute, type: c.type });
    }
  }
  if (awayLineup) {
    for (const c of awayLineup.cards) {
      allCards.push({ team: awayTeamLabel, name: c.name, minute: c.minute, type: c.type });
    }
  }
  allCards.sort((a, b) => a.minute - b.minute);

  // Build referee object
  let refereeObj: MatchDetailReferee | undefined;
  if (meta.referee) {
    refereeObj = {
      name: meta.referee.name,
      nationality: meta.referee.nationality,
    };
    if (assistants.length > 0) refereeObj.assistants = assistants;
    if (varRef) refereeObj.var = varRef;
  }

  // Build lineups with correct team orientation
  let lineups: MatchDetailLineups | undefined;
  if (homeLineup && awayLineup) {
    if (flipped) {
      lineups = {
        home: { starting: awayLineup.starting, subs: awayLineup.subs },
        away: { starting: homeLineup.starting, subs: homeLineup.subs },
      };
    } else {
      lineups = {
        home: { starting: homeLineup.starting, subs: homeLineup.subs },
        away: { starting: awayLineup.starting, subs: awayLineup.subs },
      };
    }
  }

  const detail: MatchDetail = { goals };
  if (meta.attendance !== null) detail.attendance = meta.attendance;
  if (motm) detail.motm = motm;
  if (refereeObj) detail.referee = refereeObj;
  if (lineups) detail.lineups = lineups;
  if (allCards.length > 0) detail.cards = allCards;
  if (meta.venue) detail.venue = meta.venue;

  return detail;
}

// ── Split Wikipedia page into per-match sections ─────────────────────

function splitIntoMatchSections(html: string): string[] {
  const sections: string[] = [];
  const footballboxRe = /<div [^>]*class="footballbox"[^>]*>/g;
  const indices: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = footballboxRe.exec(html)) !== null) {
    indices.push(m.index);
  }
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : html.length;
    sections.push(html.slice(start, end));
  }
  return sections;
}

// ── Main enrichment function ─────────────────────────────────────────

async function enrichFinishedMatches(
  env: Env,
  host: string,
  _matchMap: MatchMap,
): Promise<{ needed: number; updated: number; errors: string[] }> {
  // 1. Query DB for finished matches where match_detail is NULL
  const stateRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/wc26_match_results?select=match_id,payload,match_detail&match_detail=is.null`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!stateRes.ok) {
    return { needed: 0, updated: 0, errors: [`enrich select: ${stateRes.status}`] };
  }
  const stateRows: EnrichSyncState[] = await stateRes.json();

  // Filter: only FINISHED matches, only group-stage matches
  const toEnrich = stateRows.filter(r => {
    if (r.payload?.status !== 'FINISHED') return false;
    // Only group-stage matches (match_id starts with G-)
    if (!r.match_id.startsWith('G-')) return false;
    return true;
  });

  if (toEnrich.length === 0) {
    return { needed: 0, updated: 0, errors: [] };
  }

  // Limit to max 3 per tick
  const batch = toEnrich.slice(0, 3);

  // 2. Group by group letter to minimize Wikipedia fetches
  const byGroup = new Map<string, typeof batch>();
  for (const row of batch) {
    const group = row.match_id.split('-')[1]; // G-A-1 → A
    if (!group) continue;
    const list = byGroup.get(group) ?? [];
    list.push(row);
    byGroup.set(group, list);
  }

  // Fetch our match info for team lookups
  let ourMatches: OurMatchInfo[];
  try {
    ourMatches = await fetchOurMatches(host);
  } catch (e) {
    return { needed: batch.length, updated: 0, errors: [(e as Error).message] };
  }
  const ourMatchById = new Map(ourMatches.map(m => [m.match_id, m]));

  const errors: string[] = [];
  let updated = 0;

  // 3. For each group, fetch the Wikipedia page and parse
  for (const [group, matches] of byGroup) {
    let html: string;
    try {
      html = await fetchWikiGroupPage(group);
    } catch (e) {
      errors.push((e as Error).message);
      continue;
    }

    const sections = splitIntoMatchSections(html);

    for (const row of matches) {
      const ourMatch = ourMatchById.get(row.match_id);
      if (!ourMatch) continue;

      // Find the correct section by trying team pair + date matching
      let detail: MatchDetail | null = null;
      for (const sec of sections) {
        // Quick check: does this section reference our teams?
        const dateM = sec.match(/class="bday[^"]*">(\d{4}-\d{2}-\d{2})/);
        const secDate = dateM?.[1];
        if (secDate) {
          // Verify date is within ±1 day
          const dateShifts = [ourMatch.date, shiftDate(ourMatch.date, +1), shiftDate(ourMatch.date, -1)];
          if (!dateShifts.includes(secDate)) continue;
        }

        detail = parseMatchDetailSection(sec, ourMatch.team1, ourMatch.team2);
        if (detail) break;
      }

      if (!detail || !detail.lineups) continue; // Don't write partial data without lineups

      // 4. Write match_detail to DB
      const patchRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/wc26_match_results?match_id=eq.${encodeURIComponent(row.match_id)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'content-type': 'application/json',
            prefer: 'return=minimal',
          },
          body: JSON.stringify({ match_detail: detail }),
        },
      );
      if (!patchRes.ok) {
        errors.push(`enrich ${row.match_id}: ${patchRes.status} ${await patchRes.text()}`);
      } else {
        updated++;
      }
    }
  }

  return { needed: batch.length, updated, errors };
}

// ── Rebuild player stats from all match_detail ─────────────────────────

interface PlayerStat {
  name: string;
  team: string;
  goals: number;
  penalties: number;
  own_goals: number;
  yellow_cards: number;
  red_cards: number;
  motm: number;
  appearances: number;
}

async function rebuildPlayerStats(env: Env, matchMap: MatchMap): Promise<{ upserted: number; error?: string }> {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  };

  // Fetch all match_detail + match teams from data.json team mapping
  const res = await fetch(`${url}/rest/v1/wc26_match_results?select=match_id,match_detail&match_detail=not.is.null`, { headers });
  if (!res.ok) return { upserted: 0, error: `fetch failed: ${res.status}` };

  const rows = await res.json() as Array<{ match_id: string; match_detail: Record<string, unknown> }>;
  const stats: Record<string, PlayerStat> = {};

  const ensure = (name: string, team: string): PlayerStat => {
    const key = `${name}|||${team}`;
    if (!stats[key]) stats[key] = { name, team, goals: 0, penalties: 0, own_goals: 0, yellow_cards: 0, red_cards: 0, motm: 0, appearances: 0 };
    return stats[key];
  };

  for (const row of rows) {
    const mapEntry = matchMap[row.match_id];
    const homeTeam = mapEntry?.home ?? 'home';
    const awayTeam = mapEntry?.away ?? 'away';
    const resolveTeam = (t: string) => t === 'home' ? homeTeam : awayTeam;

    const d = row.match_detail as {
      goals?: Array<{ team: string; name: string; kind: string }>;
      cards?: Array<{ team: string; name: string; type: string }>;
      motm?: { name: string; team: string };
      lineups?: { home?: { starting?: Array<{ name: string }>; subs?: Array<{ name: string }> }; away?: { starting?: Array<{ name: string }>; subs?: Array<{ name: string }> } };
    };

    // Goals
    if (d.goals) {
      for (const g of d.goals) {
        const name = g.name?.trim();
        if (!name) continue;
        const p = ensure(name, resolveTeam(g.team));
        if (g.kind === 'own-goal') p.own_goals++;
        else {
          p.goals++;
          if (g.kind === 'penalty') p.penalties++;
        }
      }
    }

    // Cards
    if (d.cards) {
      for (const c of d.cards) {
        const name = c.name?.trim();
        if (!name) continue;
        const p = ensure(name, resolveTeam(c.team));
        if (c.type === 'yellow') p.yellow_cards++;
        else if (c.type === 'red' || c.type === 'second-yellow') p.red_cards++;
      }
    }

    // MOTM
    if (d.motm?.name) {
      ensure(d.motm.name.trim(), resolveTeam(d.motm.team)).motm++;
    }
  }

  const upsertRows = Object.values(stats);
  if (upsertRows.length === 0) return { upserted: 0 };

  // Delete all existing and re-insert (full rebuild is fine for <200 rows)
  await fetch(`${url}/rest/v1/wc26_player_stats?name=not.is.null`, {
    method: 'DELETE',
    headers,
  });

  const insertRes = await fetch(`${url}/rest/v1/wc26_player_stats`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(upsertRows),
  });

  if (!insertRes.ok) return { upserted: 0, error: `insert failed: ${insertRes.status}` };
  return { upserted: upsertRows.length };
}

// ── Rebuild team stats from match results + match_detail ───────────────

interface TeamStat {
  team: string;
  goals_for: number;
  goals_against: number;
  penalties: number;
  yellow_cards: number;
  red_cards: number;
}

async function rebuildTeamStats(env: Env, matchMap: MatchMap): Promise<{ upserted: number; error?: string }> {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  };

  // Fetch all results with match_detail
  const res = await fetch(`${url}/rest/v1/wc26_match_results?select=match_id,team1_score,team2_score,match_detail`, { headers });
  if (!res.ok) return { upserted: 0, error: `fetch failed: ${res.status}` };

  const rows = await res.json() as Array<{
    match_id: string;
    team1_score: number;
    team2_score: number;
    match_detail: Record<string, unknown> | null;
  }>;

  const stats: Record<string, TeamStat> = {};
  const ensure = (team: string): TeamStat => {
    if (!stats[team]) stats[team] = { team, goals_for: 0, goals_against: 0, penalties: 0, yellow_cards: 0, red_cards: 0 };
    return stats[team];
  };

  for (const row of rows) {
    const mapEntry = matchMap[row.match_id];
    if (!mapEntry) continue;

    const homeTeam = mapEntry.home;
    const awayTeam = mapEntry.away;
    const home = ensure(homeTeam);
    const away = ensure(awayTeam);

    // Goals for/against from scores
    home.goals_for += row.team1_score;
    home.goals_against += row.team2_score;
    away.goals_for += row.team2_score;
    away.goals_against += row.team1_score;

    // Cards and penalties from match_detail
    if (row.match_detail) {
      const d = row.match_detail as {
        goals?: Array<{ team: string; kind: string }>;
        cards?: Array<{ team: string; type: string }>;
      };

      if (d.goals) {
        for (const g of d.goals) {
          if (g.kind === 'penalty') {
            if (g.team === 'home') home.penalties++;
            else away.penalties++;
          }
        }
      }

      if (d.cards) {
        for (const c of d.cards) {
          const t = c.team === 'home' ? home : away;
          if (c.type === 'yellow') t.yellow_cards++;
          else if (c.type === 'red' || c.type === 'second-yellow') t.red_cards++;
        }
      }
    }
  }

  const upsertRows = Object.values(stats);
  if (upsertRows.length === 0) return { upserted: 0 };

  // Full rebuild
  await fetch(`${url}/rest/v1/wc26_team_stats?team=not.is.null`, {
    method: 'DELETE',
    headers,
  });

  const insertRes = await fetch(`${url}/rest/v1/wc26_team_stats`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(upsertRows),
  });

  if (!insertRes.ok) return { upserted: 0, error: `insert failed: ${insertRes.status}` };
  return { upserted: upsertRows.length };
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
  // are finished matches needing scorers.
  const wikiRes = await syncGoalScorers(ctx.env, host);

  // ── Post-match enrichment (lineups, cards, subs, MOTM, etc.) ─────
  // Only runs for finished group-stage matches missing match_detail.
  const enrichRes = await enrichFinishedMatches(ctx.env, host, matchMap);

  // ── Rebuild player stats from all match_detail ─────────────────────
  const playerStatsRes = await rebuildPlayerStats(ctx.env, matchMap);

  // ── Rebuild team stats ─────────────────────────────────────────────
  const teamStatsRes = await rebuildTeamStats(ctx.env, matchMap);

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
    enrich: { needed: enrichRes.needed, updated: enrichRes.updated },
    player_stats: playerStatsRes,
    team_stats: teamStatsRes,
    errors: [
      ...upsertRes.errors,
      ...patchRes.errors,
      ...liveUpsertRes.errors,
      ...liveDeleteRes.errors,
      ...wikiRes.errors,
      ...enrichRes.errors,
    ],
  });
};
