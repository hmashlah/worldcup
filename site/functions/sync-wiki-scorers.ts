/**
 * Cloudflare Pages Function: scrape per-match goal scorers from the
 * live Wikipedia article for the tournament, write into the
 * wiki_scorers JSONB column on wc26_match_results. Runs daily.
 *
 * Endpoint: POST https://<host>/sync-wiki-scorers
 * Auth:     x-wc26-secret header (shared with pg_cron)
 *
 * Required env vars:
 *   SUPABASE_URL              — your project URL
 *   SUPABASE_SERVICE_ROLE_KEY — bypasses RLS for the upsert
 *   WC26_WEBHOOK_SECRET       — shared secret
 *
 * Optional request body: { force?: boolean } — if true, re-scrape every
 * match even if it already has wiki_scorers populated. Default false:
 * once a match's scorer list is in the DB, we don't fetch / write again.
 *
 * Response: { matched, updated, skipped_already_synced, errors }
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WC26_WEBHOOK_SECRET: string;
}

interface RequestBody {
  force?: boolean;
}

/** A single goal as parsed from Wikipedia. `team` is relative to
 *  Wikipedia's home/away ordering — the sync function flips it on
 *  insert to match our team1/team2 ordering. */
interface WikiGoal {
  team: 'home' | 'away';
  name: string;
  minute: number;
  /** Stoppage-time minutes (the "+3" in 90+3'). Optional. */
  extraTime?: number;
  /** Wikipedia footballbox doesn't always annotate kind, but if we can
   *  detect a penalty / own-goal marker we record it. Default 'goal'. */
  kind: 'goal' | 'penalty' | 'own-goal';
}

interface WikiMatch {
  date: string;          // YYYY-MM-DD
  home: string;          // canonicalized to our naming convention
  away: string;
  home_score: number;
  away_score: number;
  goals: WikiGoal[];
}

interface OurMatchInfo {
  match_id: string;
  date: string;
  team1: string;
  team2: string;
}

/** Wikipedia uses the team's full national-team article title which
 *  always ends with " national football team" or " national soccer
 *  team". This trims the suffix and applies our usual aliases so
 *  "USA" / "United States" land on the same key. */
function canonicalizeTeam(wikiTitle: string): string {
  const ALIASES: Record<string, string> = {
    'United States': 'USA',
    'Czechia': 'Czech Republic',
    'Bosnia-Herzegovina': 'Bosnia & Herzegovina',
    'Cape Verde Islands': 'Cape Verde',
    'Congo DR': 'DR Congo',
  };
  let name = wikiTitle
    .replace(/\s+national\s+(football|soccer)\s+team$/i, '')
    .trim();
  return ALIASES[name] ?? name;
}

const decode = (s: string): string =>
  s.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#160;/g, ' ')
    .replace(/&nbsp;/g, ' ');

/**
 * Parse all <div class="footballbox"> blocks from the Wikipedia
 * article. The structure is regular and has been stable for 15+
 * years; if it ever changes, this function will return an empty array
 * and the sync function reports "matched: 0", which is loud enough.
 */
function parseFootballboxes(html: string): WikiMatch[] {
  const boxes = html.match(/<div [^>]*class="footballbox"[^>]*>[\s\S]*?<\/table>/g) ?? [];
  const out: WikiMatch[] = [];

  for (const b of boxes) {
    // Date — class="bday" inside <span>2026-06-11</span>
    const dateM = b.match(/class="bday[^"]*">(\d{4}-\d{2}-\d{2})/);
    if (!dateM) continue;
    const date = dateM[1];

    // Team names — pulled from the `title` attribute on the <a> inside
    // fhome/faway. More robust than parsing display text because the
    // display text drops the "national football team" suffix.
    const homeM = b.match(/class="fhome"[\s\S]*?title="([^"]+)"/);
    const awayM = b.match(/class="faway"[\s\S]*?title="([^"]+)"/);
    if (!homeM || !awayM) continue;
    const home = canonicalizeTeam(decode(homeM[1]));
    const away = canonicalizeTeam(decode(awayM[1]));

    // Score — class="fscore"...>2–0 (en dash, not hyphen). Some
    // matches still SCHEDULED show "vs." instead — skip those.
    const scoreM = b.match(/class="fscore"[^>]*>(?:<a[^>]*>)?\s*(\d+)\s*[–-]\s*(\d+)/);
    if (!scoreM) continue;
    const home_score = parseInt(scoreM[1], 10);
    const away_score = parseInt(scoreM[2], 10);

    // Goal lists — class="fhgoal" / "fagoal", containing <li> entries
    // each with a player title and a minute span.
    const homeGoalsBlock = b.match(/class="fhgoal"[\s\S]*?<\/td>/)?.[0] ?? '';
    const awayGoalsBlock = b.match(/class="fagoal"[\s\S]*?<\/td>/)?.[0] ?? '';

    const goals: WikiGoal[] = [
      ...parseGoalsBlock(homeGoalsBlock, 'home'),
      ...parseGoalsBlock(awayGoalsBlock, 'away'),
    ];
    // Sort by minute (+ extraTime) so the UI can render in chronological
    // order regardless of which team is on the left.
    goals.sort((a, b) => {
      const am = a.minute + (a.extraTime ?? 0) / 100;
      const bm = b.minute + (b.extraTime ?? 0) / 100;
      return am - bm;
    });

    out.push({ date, home, away, home_score, away_score, goals });
  }

  return out;
}

/** Parse a single side's goal list. */
function parseGoalsBlock(block: string, team: 'home' | 'away'): WikiGoal[] {
  const out: WikiGoal[] = [];
  // Each goal is <li>…<a title="Full Name">DisplayName</a>…<span>9'</span>…</li>
  // Minutes can be `9'`, `45+2'`, or use a series like `9', 67'` in one li for braces.
  const liMatches = block.matchAll(/<li>([\s\S]*?)<\/li>/g);
  for (const m of liMatches) {
    const li = m[1];
    // Player name: prefer the title attribute on the first <a>.
    const nameM = li.match(/<a[^>]*title="([^"]+)"/);
    const displayM = li.match(/<a[^>]*>([^<]+)</);
    const rawName = decode((nameM?.[1] ?? displayM?.[1] ?? '').trim());
    if (!rawName) continue;
    // Strip the disambiguation parenthetical Wikipedia sometimes adds:
    // "Smith (footballer, born 2000)" → "Smith"
    const name = rawName.replace(/\s*\([^)]*\)\s*$/, '');

    // Minute markers: scan all `\d+'` occurrences and any `\d+\+\d+'`.
    // A single <li> can list multiple goals by the same player.
    const minuteHits = [...li.matchAll(/(\d+)(?:\+(\d+))?\s*'/g)];
    if (minuteHits.length === 0) continue;

    // Detect goal kind via tags inside the <li>.
    // Wikipedia uses small "(pen.)" and "(o.g.)" annotations.
    const isPen = /\(\s*pen\.?\s*\)/i.test(li);
    const isOG = /\(\s*o\.?\s*g\.?\s*\)/i.test(li);
    const kind: WikiGoal['kind'] = isPen ? 'penalty' : isOG ? 'own-goal' : 'goal';

    for (const h of minuteHits) {
      const minute = parseInt(h[1], 10);
      const extraTime = h[2] ? parseInt(h[2], 10) : undefined;
      // Sanity: minutes outside [1, 130] are noise.
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
    // WMF requires a descriptive user-agent. Don't lie about identity.
    headers: {
      'User-Agent': 'wc26-prediction-league/1.0 (https://worldcup-1jo.pages.dev; admin@simple-courses.com) scorer-sync',
    },
  });
  if (!res.ok) throw new Error(`wikipedia ${res.status}: ${await res.text()}`);
  return res.text();
}

async function fetchOurMatches(_env: Env): Promise<OurMatchInfo[]> {
  // Pull match metadata from public/data.json — same source the
  // frontend uses. data.json's match key is `id`, ours is `match_id`;
  // normalize on the way out.
  const res = await fetch('https://worldcup-1jo.pages.dev/data.json');
  if (!res.ok) throw new Error(`data.json ${res.status}`);
  type DJMatch = { id: string; team1: string; team2: string; date: string };
  const data: {
    group_matches: Record<string, DJMatch[]>;
    ko_matches: DJMatch[];
  } = await res.json();
  const out: OurMatchInfo[] = [];
  for (const list of Object.values(data.group_matches)) {
    for (const m of list) {
      out.push({ match_id: m.id, date: m.date, team1: m.team1, team2: m.team2 });
    }
  }
  for (const m of data.ko_matches) {
    out.push({ match_id: m.id, date: m.date, team1: m.team1, team2: m.team2 });
  }
  return out;
}

async function fetchAlreadySynced(env: Env): Promise<Set<string>> {
  // Return the set of match_ids that already have a non-null
  // wiki_scorers value, so we can skip re-writing them.
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/wc26_match_results?select=match_id&wiki_scorers=not.is.null`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!res.ok) throw new Error(`supabase already-synced ${res.status}: ${await res.text()}`);
  const rows: Array<{ match_id: string }> = await res.json();
  return new Set(rows.map(r => r.match_id));
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

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  // 1. Auth.
  const secret = ctx.request.headers.get('x-wc26-secret') ?? '';
  if (!ctx.env.WC26_WEBHOOK_SECRET || secret !== ctx.env.WC26_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  let body: RequestBody = {};
  try {
    body = await ctx.request.json();
  } catch { /* empty body is fine */ }
  const force = body.force === true;

  // 2. Fetch sources.
  let html: string, ours: OurMatchInfo[], alreadySynced: Set<string>;
  try {
    [html, ours, alreadySynced] = await Promise.all([
      fetchWikiHtml(),
      fetchOurMatches(ctx.env),
      fetchAlreadySynced(ctx.env),
    ]);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }

  // 3. Parse Wikipedia.
  const wikiMatches = parseFootballboxes(html);

  // Build lookup: (date, sorted-team-pair) → wiki match.
  const wikiByKey = new Map<string, WikiMatch>();
  for (const w of wikiMatches) {
    const pair = [w.home, w.away].sort().join('|');
    wikiByKey.set(`${w.date}|${pair}`, w);
  }

  // 4. For each of our matches, look up the corresponding wiki record
  //    and patch wiki_scorers. Skip already-synced unless force=true.
  const errors: string[] = [];
  let matched = 0, updated = 0, skipped_already_synced = 0;

  for (const our of ours) {
    if (!force && alreadySynced.has(our.match_id)) {
      skipped_already_synced++;
      continue;
    }
    const pair = [canonicalizeTeam(our.team1), canonicalizeTeam(our.team2)].sort().join('|');
    // Wikipedia uses UTC date; our schedule uses stadium-local. Try
    // both same-day and ±1 day.
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
    matched++;

    // Wikipedia's home/away may not match our team1/team2 — flip if needed.
    const ourTeam1 = canonicalizeTeam(our.team1);
    const flipped = w.home !== ourTeam1;
    const goals: WikiGoal[] = w.goals.map(g => ({
      ...g,
      team: flipped
        ? (g.team === 'home' ? 'away' : 'home')
        : g.team,
    }));
    // Don't write empty arrays for matches that haven't started or
    // have no scored goals — that's noise vs. signal. Skip 0-0 too;
    // the goals array will be [] and we leave wiki_scorers null.
    if (goals.length === 0) continue;

    const r = await patchScorers(ctx.env, our.match_id, goals);
    if (r.ok) updated++;
    else errors.push(`${our.match_id}: ${r.error}`);
  }

  return Response.json({
    matched,
    updated,
    skipped_already_synced,
    wiki_total: wikiMatches.length,
    errors,
  });
};

function shiftDate(yyyyMmDd: string, days: number): string {
  // Manual day arithmetic to avoid timezone surprises.
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
