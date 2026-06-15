/**
 * Build a head-to-head index from the World Cup archive folders in the
 * repo root (1930-2022). Output is a single JSON file fetched once by
 * the client.
 *
 * Run: node site/scripts/build-h2h.mjs
 *
 * Output shape (site/public/data/h2h.json):
 * {
 *   "Argentina|Brazil": [
 *     {
 *       year: 2022,
 *       round: "Quarter-finals",       // normalized
 *       date: "2022-12-09",
 *       venue: "Lusail Stadium, Lusail",
 *       team1: "Netherlands",          // home/left in original record
 *       team2: "Argentina",
 *       score: { ft: [2,2], ht: [0,1] },
 *       scorers1: [{name, minute, penalty?}, ...],
 *       scorers2: [...]
 *     },
 *     ...
 *   ],
 *   ...
 * }
 *
 * Keys are sorted-team-pair joined with "|" using the CANONICAL name (so
 * "West Germany" history shows up under "Germany|<other>"). The match
 * record preserves the *original* team1/team2 strings so the UI can
 * display "West Germany" if it was West Germany at the time.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..');

// Canonical-name map. Left = name as it appears in archive JSON, right =
// name we use today. Keep this list short and well-justified — random
// renames will silently break the lookup.
const ALIASES = {
  'West Germany': 'Germany',
  'East Germany': 'Germany',                 // rare; pre-1990
  'Soviet Union': 'Russia',                  // 1958-1990 → Russia
  'Czechoslovakia': 'Czech Republic',        // dissolved 1993
  'Yugoslavia': 'Serbia',                    // most successor states play as Serbia
  'Serbia and Montenegro': 'Serbia',         // 2003-2006
  'Zaire': 'DR Congo',
  'Dutch East Indies': 'Indonesia',
};

const canonical = (name) => ALIASES[name] ?? name;

// Map archive `round` strings (which vary by edition: "Matchday 1",
// "Round of 16", "First round", "Final round Group 1", etc.) to a small
// set of normalized labels for display. Group rounds → "Group stage";
// playoff/KO rounds → their canonical name; finals/3rd-place stay as-is.
function normalizeRound(round) {
  if (!round) return 'Group stage';
  const r = String(round).toLowerCase();
  if (r.includes('matchday') || r.includes('first round') || r.includes('group')) return 'Group stage';
  if (r.includes('round of 16')) return 'Round of 16';
  if (r.includes('quarter')) return 'Quarter-finals';
  if (r.includes('semi')) return 'Semi-finals';
  if (r.includes('third place') || r.includes('3rd place') || r.includes('match for third')) return 'Third place';
  if (r.includes('final')) return 'Final';
  if (r.includes('replay')) return 'Replay';
  return round; // fallback: show the raw string
}

function readWorldCupFile(year) {
  const path = join(REPO_ROOT, String(year), 'worldcup.json');
  try {
    statSync(path);
  } catch {
    return null;
  }
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw);
}

function buildIndex() {
  // 2026 isn't played yet; 2025 in this repo is the Club WC (different
  // file). Cap at 2022 — this list is stable, so there's no point
  // including future folders that exist only as fixture stubs.
  const CUTOFF_YEAR = 2022;
  const years = readdirSync(REPO_ROOT)
    .filter(d => /^(19|20)\d{2}$/.test(d))
    .map(Number)
    .filter(y => y <= CUTOFF_YEAR)
    .sort((a, b) => a - b);

  const index = {};
  let totalMatches = 0;
  let skippedNoScore = 0;

  for (const year of years) {
    const data = readWorldCupFile(year);
    if (!data || !Array.isArray(data.matches)) continue;

    for (const m of data.matches) {
      const t1 = m.team1, t2 = m.team2;
      if (!t1 || !t2) continue;
      // Skip matches with no final-time score — these are TBD/cancelled
      // (e.g. wartime forfeits).
      if (!m.score || !Array.isArray(m.score.ft) || m.score.ft.length !== 2) {
        skippedNoScore++;
        continue;
      }

      const c1 = canonical(t1);
      const c2 = canonical(t2);
      // Skip self-matches that result from aliasing (e.g. East vs West
      // Germany would both canonicalize to Germany — there were no such
      // WC matches but be safe).
      if (c1 === c2) continue;

      const key = [c1, c2].sort().join('|');
      const rec = {
        competition: 'World Cup',
        year,
        round: normalizeRound(m.round),
        date: m.date ?? null,
        venue: m.ground ?? null,
        team1: t1,
        team2: t2,
        score: m.score,
        scorers1: Array.isArray(m.goals1) ? m.goals1 : [],
        scorers2: Array.isArray(m.goals2) ? m.goals2 : [],
      };
      (index[key] ??= []).push(rec);
      totalMatches++;
    }
  }

  return { index, totalMatches, skippedNoScore, years };
}

function main() {
  const { index, totalMatches, skippedNoScore, years } = buildIndex();
  const outDir = join(REPO_ROOT, 'site', 'public', 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'h2h.json');

  // Only include H2H pairs where BOTH teams are in this tournament.
  // Cuts the file size dramatically — Wikipedia gives us 1006 pairs but
  // only ~48 choose 2 = 1128 are even potentially meaningful, and in
  // practice far fewer of those have any prior tournament meetings.
  // The frontend wouldn't render the rest anyway.
  const tournamentTeams = readCurrentTournamentTeams();
  const teamSet = new Set(tournamentTeams.map(canonical));

  // Merge in the Wikipedia-scraped tournaments (Euros, Copa, AFCON,
  // Asian Cup, Confederations Cup) if present. The scraper writes to
  // wiki-h2h.json with the same per-pair shape, so merging is a flat
  // concat per key. If the scraper hasn't been run yet, the merge is
  // a no-op.
  const wikiPath = join(outDir, 'wiki-h2h.json');
  let wikiAdded = 0;
  try {
    const wiki = JSON.parse(readFileSync(wikiPath, 'utf8'));
    for (const [key, list] of Object.entries(wiki.pairs ?? {})) {
      (index[key] ??= []).push(...list);
      wikiAdded += list.length;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('  no wiki-h2h.json found — run scrape-wiki-tournaments.mjs to add Euros/Copa/AFCON/Asian/Confed Cup history');
  }

  // Filter pairs: keep only when both canonical teams are competing.
  let droppedPairs = 0;
  let droppedMatches = 0;
  for (const key of Object.keys(index)) {
    const [a, b] = key.split('|');
    if (!teamSet.has(a) || !teamSet.has(b)) {
      droppedMatches += index[key].length;
      droppedPairs++;
      delete index[key];
    }
  }

  // Sort each remaining pair newest first across all sources.
  for (const key of Object.keys(index)) {
    index[key].sort((a, b) =>
      (b.year - a.year) || (a.date ?? '').localeCompare(b.date ?? '')
    );
  }

  const payload = {
    source_years: years,
    aliases: ALIASES,
    pairs: index,
  };

  writeFileSync(outPath, JSON.stringify(payload));
  const pairs = Object.keys(index).length;
  const keptMatches = Object.values(index).reduce((sum, list) => sum + list.length, 0);
  console.log(`wrote ${outPath}`);
  console.log(`  ${totalMatches} WC matches + ${wikiAdded} Wikipedia matches collected`);
  console.log(`  filtered to ${tournamentTeams.length} participating teams: ${pairs} pairs / ${keptMatches} matches kept`);
  console.log(`  dropped ${droppedPairs} pairs / ${droppedMatches} matches not involving 2026 teams`);
  console.log(`  WC source years: ${years[0]}-${years[years.length - 1]} (${years.length} editions)`);
  if (skippedNoScore) console.log(`  skipped ${skippedNoScore} matches with no final-time score`);
}

/** Read the 48 teams competing in WC 2026 from data.json (already
 *  produced by build-data.py from the upstream openfootball source). */
function readCurrentTournamentTeams() {
  const dataPath = join(REPO_ROOT, 'site', 'public', 'data.json');
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  const teams = new Set();
  for (const m of (data.group_matches ? Object.values(data.group_matches).flat() : [])) {
    if (m.team1) teams.add(m.team1);
    if (m.team2) teams.add(m.team2);
  }
  return [...teams];
}

main();
