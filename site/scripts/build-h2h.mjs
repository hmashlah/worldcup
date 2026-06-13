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

  // Sort each pair's history newest first.
  for (const key of Object.keys(index)) {
    index[key].sort((a, b) => b.year - a.year || (a.date || '').localeCompare(b.date || ''));
  }

  return { index, totalMatches, skippedNoScore, years };
}

function main() {
  const { index, totalMatches, skippedNoScore, years } = buildIndex();
  const outDir = join(REPO_ROOT, 'site', 'public', 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'h2h.json');

  const payload = {
    generated_at: new Date(0).toISOString().replace('1970-01-01T00:00:00.000Z', 'build-time'),
    source_years: years,
    aliases: ALIASES,
    pairs: index,
  };
  // Don't bake a real timestamp — keeps the file content-addressable so
  // CDN caching stays effective across rebuilds with no data change.
  delete payload.generated_at;

  writeFileSync(outPath, JSON.stringify(payload));
  const pairs = Object.keys(index).length;
  console.log(`wrote ${outPath}`);
  console.log(`  ${totalMatches} matches across ${pairs} pairs`);
  console.log(`  source years: ${years[0]}-${years[years.length - 1]} (${years.length} editions)`);
  if (skippedNoScore) console.log(`  skipped ${skippedNoScore} matches with no final-time score`);
}

main();
