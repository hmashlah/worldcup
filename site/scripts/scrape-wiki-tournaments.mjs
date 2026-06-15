/**
 * Build-time scraper that fetches Wikipedia tournament articles for the
 * major international competitions and emits a head-to-head JSON file
 * (site/public/data/wiki-h2h.json) keyed by sorted-team-pair.
 *
 * Combined with the existing build-h2h.mjs (which builds the WC archive
 * from the repo's 1930-2022 folders), this gives us multi-competition
 * H2H data for every team pair.
 *
 * Usage:
 *   node site/scripts/scrape-wiki-tournaments.mjs
 *
 * Output: site/public/data/wiki-h2h.json with shape:
 *   {
 *     pairs: {
 *       "Argentina|Brazil": [
 *         { competition: "Copa America", year: 2021, round: "Final",
 *           date: "2021-07-10", venue: "Maracanã, Rio de Janeiro",
 *           team1: "Argentina", team2: "Brazil",
 *           score: { ft: [1,0] }, scorers1: [...], scorers2: [...] },
 *         ...
 *       ],
 *       ...
 *     }
 *   }
 *
 * Network policy:
 *   - Sequential fetches (no parallelism) to be polite to Wikipedia.
 *   - Descriptive User-Agent per WMF policy.
 *   - Articles are cached locally between runs in .cache/wiki/ so
 *     re-runs are fast and don't re-hit the network.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..');
const CACHE_DIR = join(REPO_ROOT, 'site', '.cache', 'wiki');
const OUT_PATH = join(REPO_ROOT, 'site', 'public', 'data', 'wiki-h2h.json');

const USER_AGENT = 'wc26-prediction-league/1.0 (https://worldcup-1jo.pages.dev; admin@simple-courses.com) tournament-h2h';

// Tournament catalog. Each entry produces one Wikipedia article URL and
// is tagged with a competition name + year used in the output rows.
//
// Older editions sometimes use slugs without diacritics (Copa America)
// — encode each URL exactly as Wikipedia serves it.
const TOURNAMENTS = buildCatalog();

function buildCatalog() {
  const out = [];

  // UEFA European Championship — 1960 → 2024 (every 4y, except 2020 → 2021)
  const euroEditions = [
    1960, 1964, 1968, 1972, 1976, 1980, 1984, 1988, 1992, 1996,
    2000, 2004, 2008, 2012, 2016, 2024,
  ];
  for (const y of euroEditions) {
    out.push({ competition: 'Euros', year: y, url: `https://en.wikipedia.org/wiki/UEFA_Euro_${y}` });
  }
  // 2020 was held in 2021 but Wikipedia still uses "UEFA Euro 2020".
  out.push({ competition: 'Euros', year: 2020, url: 'https://en.wikipedia.org/wiki/UEFA_Euro_2020' });

  // Copa America — major editions in the modern era (skip the very
  // earliest, which use a different page format and have spotty data).
  const copaEditions = [
    1987, 1989, 1991, 1993, 1995, 1997, 1999, 2001, 2004, 2007,
    2011, 2015, 2016, 2019, 2021, 2024,
  ];
  for (const y of copaEditions) {
    out.push({ competition: 'Copa America', year: y, url: `https://en.wikipedia.org/wiki/${y}_Copa_Am%C3%A9rica` });
  }

  // Africa Cup of Nations — 1957 → 2023.
  // Wikipedia uses "African Cup of Nations" for early editions and
  // "Africa Cup of Nations" for modern. We try both via fallback URLs.
  const afconYears = [
    1957, 1959, 1962, 1963, 1965, 1968, 1970, 1972, 1974, 1976,
    1978, 1980, 1982, 1984, 1986, 1988, 1990, 1992, 1994, 1996,
    1998, 2000, 2002, 2004, 2006, 2008, 2010, 2012, 2013, 2015,
    2017, 2019, 2021, 2023,
  ];
  for (const y of afconYears) {
    // Modern naming
    out.push({ competition: 'AFCON', year: y, url: `https://en.wikipedia.org/wiki/${y}_Africa_Cup_of_Nations` });
  }

  // AFC Asian Cup — 1956 → 2023. Slug is "1956_AFC_Asian_Cup".
  const asianYears = [
    1956, 1960, 1964, 1968, 1972, 1976, 1980, 1984, 1988, 1992,
    1996, 2000, 2004, 2007, 2011, 2015, 2019, 2023,
  ];
  for (const y of asianYears) {
    out.push({ competition: 'Asian Cup', year: y, url: `https://en.wikipedia.org/wiki/${y}_AFC_Asian_Cup` });
  }

  // FIFA Confederations Cup — discontinued after 2017.
  const confedYears = [1992, 1995, 1997, 1999, 2001, 2003, 2005, 2009, 2013, 2017];
  for (const y of confedYears) {
    out.push({ competition: 'Confederations Cup', year: y, url: `https://en.wikipedia.org/wiki/${y}_FIFA_Confederations_Cup` });
  }

  return out;
}

// ──────────────────────────────────────────────────────────────────────
// HTML decoding + team-name normalization (matches sync-wiki-scorers.ts)
// ──────────────────────────────────────────────────────────────────────

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#160;/g, ' ')
    .replace(/&nbsp;/g, ' ');
}

const TEAM_ALIASES = {
  'United States': 'USA',
  'Czechia': 'Czech Republic',
  'Bosnia-Herzegovina': 'Bosnia & Herzegovina',
  'Bosnia and Herzegovina': 'Bosnia & Herzegovina',
  'Cape Verde Islands': 'Cape Verde',
  'Congo DR': 'DR Congo',
  // Defunct nations → their successor for canonical-pair matching
  'West Germany': 'Germany',
  'East Germany': 'Germany',
  'Soviet Union': 'Russia',
  'CIS': 'Russia',
  'Czechoslovakia': 'Czech Republic',
  'Yugoslavia': 'Serbia',
  'Serbia and Montenegro': 'Serbia',
  'FR Yugoslavia': 'Serbia',
  'Zaire': 'DR Congo',
  'Burma': 'Myanmar',
  'South Vietnam': 'Vietnam',
  'Khmer Republic': 'Cambodia',
};

function canonicalizeTeam(wikiTitle) {
  const stripped = wikiTitle
    .replace(/\s+(?:men[''’]s\s+)?national\s+(?:football|soccer|association football)\s+team$/i, '')
    .trim();
  return TEAM_ALIASES[stripped] ?? stripped;
}

// ──────────────────────────────────────────────────────────────────────
// Scraper
// ──────────────────────────────────────────────────────────────────────

async function fetchWithCache(url) {
  // Hash the URL to a flat filename. crypto.subtle would be overkill
  // for a build script; a deterministic slug is enough.
  const slug = url.replace(/[^a-z0-9]+/gi, '_').slice(0, 200);
  const cachePath = join(CACHE_DIR, `${slug}.html`);
  if (existsSync(cachePath)) {
    // Use cached copy if less than 30 days old. Tournament results
    // don't change after the trophy is lifted.
    const ageMs = Date.now() - statSync(cachePath).mtimeMs;
    if (ageMs < 30 * 24 * 3600 * 1000) {
      return readFileSync(cachePath, 'utf8');
    }
  }
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    if (res.status === 404) return null; // tolerate missing articles
    throw new Error(`${url}: ${res.status}`);
  }
  const html = await res.text();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, html);
  return html;
}

/**
 * Parse all <div class="footballbox"> blocks. Mirrors the per-match
 * parser in sync-wiki-scorers.ts, but extracts more fields (round,
 * venue) needed for H2H display.
 */
function parseFootballboxes(html, fallbackYear) {
  const boxes = html.match(/<div [^>]*class="footballbox"[^>]*>[\s\S]*?<\/table>/g) ?? [];
  const out = [];

  for (const b of boxes) {
    // Date — class="bday" inside <span>2024-06-14</span>.
    let date = null;
    const dateM = b.match(/class="bday[^"]*">(\d{4}-\d{2}-\d{2})/);
    if (dateM) date = dateM[1];

    // Year fallback for old articles where bday is missing.
    const year = date ? parseInt(date.slice(0, 4), 10) : fallbackYear;

    // Team names from the title attribute.
    const homeM = b.match(/class="fhome"[\s\S]*?title="([^"]+)"/);
    const awayM = b.match(/class="faway"[\s\S]*?title="([^"]+)"/);
    if (!homeM || !awayM) continue;
    const home = canonicalizeTeam(decode(homeM[1]));
    const away = canonicalizeTeam(decode(awayM[1]));
    // Original (non-canonicalized) names for display, so the UI can
    // show "West Germany" etc. as it was at the time.
    const homeDisplay = decode(homeM[1]).replace(/\s+(?:men[''’]s\s+)?national\s+(?:football|soccer|association football)\s+team$/i, '').trim();
    const awayDisplay = decode(awayM[1]).replace(/\s+(?:men[''’]s\s+)?national\s+(?:football|soccer|association football)\s+team$/i, '').trim();

    // Score. Some articles mark unfinished/cancelled matches with "v"
    // or "–" — skip those.
    const scoreM = b.match(/class="fscore"[^>]*>(?:<a[^>]*>)?\s*(\d+)\s*[–-]\s*(\d+)/);
    if (!scoreM) continue;
    const home_score = parseInt(scoreM[1], 10);
    const away_score = parseInt(scoreM[2], 10);

    // Round — Wikipedia articles vary widely. Look at the closest
    // <h2>/<h3>/<h4> heading above this footballbox in the article.
    // For build purposes we punt and just store a generic label; the
    // UI will show competition + year, which is the dominant signal.
    // (Could later be enriched by anchor-section parsing.)
    const round = '';

    // Venue: <div class="fright"> contains "<a>...</a>, <a>...</a>".
    let venue = null;
    const vM = b.match(/class="fright"[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
    if (vM) venue = decode(vM[1]).trim();

    // Goal scorers — present in modern articles, absent in pre-1990
    // tournament summaries. Reuse the same minute-pattern parser as
    // sync-wiki-scorers but in a simpler shape (no penalty/OG tags
    // — too inconsistent across older edits to bother).
    const homeGoalsBlock = b.match(/class="fhgoal"[\s\S]*?<\/td>/)?.[0] ?? '';
    const awayGoalsBlock = b.match(/class="fagoal"[\s\S]*?<\/td>/)?.[0] ?? '';
    const scorers1 = parseScorers(homeGoalsBlock);
    const scorers2 = parseScorers(awayGoalsBlock);

    out.push({
      year,
      date,
      home,
      away,
      home_display: homeDisplay,
      away_display: awayDisplay,
      home_score,
      away_score,
      venue,
      round,
      scorers1,
      scorers2,
    });
  }

  return out;
}

function parseScorers(block) {
  const out = [];
  const liRe = /<li>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(block)) !== null) {
    const li = m[1];
    const nameM = li.match(/<a[^>]*title="([^"]+)"/) || li.match(/<a[^>]*>([^<]+)</);
    if (!nameM) continue;
    const rawName = decode(nameM[1]).trim().replace(/\s*\([^)]*\)\s*$/, '');
    if (!rawName) continue;
    const minutes = [...li.matchAll(/(\d+)(?:\+(\d+))?\s*'/g)];
    if (minutes.length === 0) continue;
    for (const mm of minutes) {
      const minute = parseInt(mm[1], 10);
      if (minute < 1 || minute > 130) continue;
      const o = { name: rawName, minute };
      if (mm[2]) o.offset = parseInt(mm[2], 10);
      out.push(o);
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Scraping ${TOURNAMENTS.length} tournament articles…`);
  const pairs = {};
  let totalMatches = 0;
  let articlesParsed = 0;
  let articlesMissing = 0;

  for (const t of TOURNAMENTS) {
    const html = await fetchWithCache(t.url);
    if (html === null) {
      articlesMissing++;
      continue;
    }
    const matches = parseFootballboxes(html, t.year);
    articlesParsed++;
    for (const m of matches) {
      // Self-matches (e.g. East vs West Germany, both → Germany) are
      // dropped — they'd canonicalize to the same key.
      if (m.home === m.away) continue;
      const key = [m.home, m.away].sort().join('|');
      const rec = {
        competition: t.competition,
        year: m.year,
        round: m.round,
        date: m.date,
        venue: m.venue,
        team1: m.home_display,
        team2: m.away_display,
        score: { ft: [m.home_score, m.away_score] },
        scorers1: m.scorers1,
        scorers2: m.scorers2,
      };
      (pairs[key] ??= []).push(rec);
      totalMatches++;
    }
  }

  // Sort each pair newest first.
  for (const key of Object.keys(pairs)) {
    pairs[key].sort((a, b) => (b.year - a.year) || (a.date || '').localeCompare(b.date || ''));
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({ pairs }));
  console.log(`  parsed ${articlesParsed} articles (${articlesMissing} missing)`);
  console.log(`  ${totalMatches} matches across ${Object.keys(pairs).length} pairs`);
  console.log(`  wrote ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
