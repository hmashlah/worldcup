/**
 * One-time script to map our internal match IDs (G-A-1, M73, M-Final, …)
 * to football-data.org's numeric match IDs.
 *
 * Usage:
 *   FOOTBALL_DATA_API_KEY=... node site/scripts/build-fd-match-map.mjs
 *
 * Output:
 *   site/public/data/fd-match-map.json
 *
 * Why a build-time map and not a runtime fuzzy match?
 *   - Team names differ across data sources (e.g. our data.json calls them
 *     "United States", football-data.org also says "United States" — but
 *     "Czechia" vs "Czech Republic", "Bosnia and Herzegovina" vs
 *     "Bosnia-Herzegovina" etc. require an alias map).
 *   - Doing this once and committing the result means no surprises in the
 *     /sync-matches function at runtime, and a human can sanity-check the
 *     mapping before it goes live.
 *
 * Re-run if team rosters change (e.g. KO bracket fills in real teams in
 * place of slot tokens — the script will populate those rows on rerun).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..');
const DATA_JSON_PATH = join(REPO_ROOT, 'site', 'public', 'data.json');
const OUT_PATH = join(REPO_ROOT, 'site', 'public', 'data', 'fd-match-map.json');

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
if (!API_KEY) {
  console.error('FOOTBALL_DATA_API_KEY env var is required');
  process.exit(1);
}

// Team-name aliases: data.json side → football-data.org side.
// Add entries when this script logs an unmatched team.
const TEAM_ALIASES = {
  // data.json name : football-data.org name
  'Bosnia & Herzegovina': 'Bosnia-Herzegovina',
  'Cape Verde': 'Cape Verde Islands',
  'Czech Republic': 'Czechia',
  'DR Congo': 'Congo DR',
  'USA': 'United States',
  // The rest already agree (Curaçao, Ivory Coast, South Korea, …).
};

const norm = (n) => (TEAM_ALIASES[n] ?? n).trim().toLowerCase();

async function fetchAllWCMatches() {
  const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
    headers: { 'X-Auth-Token': API_KEY },
  });
  if (!res.ok) {
    throw new Error(`football-data.org responded ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  return body.matches ?? [];
}

function loadOurMatches() {
  const data = JSON.parse(readFileSync(DATA_JSON_PATH, 'utf8'));
  const matches = [];
  for (const [groupName, list] of Object.entries(data.group_matches)) {
    for (const m of list) {
      matches.push({
        id: m.id,
        team1: m.team1,
        team2: m.team2,
        date: m.date,         // "2026-06-11"
        kind: 'group',
        group: groupName,
      });
    }
  }
  for (const m of data.ko_matches) {
    matches.push({
      id: m.id,
      team1: m.team1,         // could be a slot token like "1A" / "W74"
      team2: m.team2,
      date: m.date,
      kind: 'ko',
      round: m.round,
    });
  }
  return matches;
}

function buildMap(ourMatches, fdMatches) {
  // Index FD matches by sortedTeamPair, plus a (pair, date) index used
  // when a pair appears more than once (KO meetings of teams that also
  // played in groups). For group stage every pair is unique.
  //
  // We can't index by exact (date, pair) because our data.json stores the
  // local kickoff date while FD returns utcDate — when a match kicks off
  // late evening locally, those differ by a day.
  const fdByPair = new Map();          // pair → [match, …]
  const fdByPairAndDate = new Map();   // `${date}|${pair}` → match
  for (const m of fdMatches) {
    const date = (m.utcDate ?? '').slice(0, 10);
    const home = norm(m.homeTeam?.name ?? '');
    const away = norm(m.awayTeam?.name ?? '');
    if (!home || !away) continue;
    const pairKey = [home, away].sort().join('|');
    if (!fdByPair.has(pairKey)) fdByPair.set(pairKey, []);
    fdByPair.get(pairKey).push(m);
    if (date) fdByPairAndDate.set(`${date}|${pairKey}`, m);
  }

  const mapping = {};
  const unmatched = [];

  for (const our of ourMatches) {
    // KO matches with slot tokens ("1A", "W74") can't be matched until the
    // bracket fills. Skip silently — re-run after groups complete to add
    // KO entries.
    const t1 = norm(our.team1);
    const t2 = norm(our.team2);
    const looksResolvable = !/^[123][A-L]/.test(our.team1) && !/^[WL]\d+$/.test(our.team1)
                          && !/^[123][A-L]/.test(our.team2) && !/^[WL]\d+$/.test(our.team2);
    if (!looksResolvable) continue;

    const pairKey = [t1, t2].sort().join('|');
    const fdCandidates = fdByPair.get(pairKey) ?? [];

    let fd = null;
    if (fdCandidates.length === 1) {
      // Group stage: every pair appears exactly once. Easy.
      fd = fdCandidates[0];
    } else if (fdCandidates.length > 1) {
      // Multiple meetings (rare — would require a KO rematch). Pick the
      // closest by date (±1 day), to handle UTC-vs-local boundary slips.
      fd = fdCandidates.find(m => {
        const fdDate = (m.utcDate ?? '').slice(0, 10);
        return datesWithinOneDay(fdDate, our.date);
      }) ?? null;
    }

    if (fd) {
      // Are our team1/team2 in the same order as FD's home/away? If not,
      // /sync-matches needs to flip the scores when upserting. Compute
      // and store this once here.
      const fdHome = norm(fd.homeTeam?.name ?? '');
      const ourTeam1 = norm(our.team1);
      const sameOrder = fdHome === ourTeam1;
      mapping[our.id] = {
        fd_id: fd.id,
        home: fd.homeTeam?.name,
        away: fd.awayTeam?.name,
        date: fd.utcDate?.slice(0, 10),
        // false → /sync-matches must swap scores: ours.team1_score = fd.score.away
        same_order_as_fd: sameOrder,
      };
    } else {
      unmatched.push({
        our,
        reason: fdCandidates.length === 0 ? 'no FD pair match' : 'multiple candidates, none within 1 day',
      });
    }
  }

  return { mapping, unmatched };
}

function datesWithinOneDay(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return ms <= 24 * 60 * 60 * 1000 + 1000;
}

async function main() {
  console.log('Fetching WC matches from football-data.org…');
  const fdMatches = await fetchAllWCMatches();
  console.log(`  ${fdMatches.length} matches returned`);

  const ourMatches = loadOurMatches();
  console.log(`Our schedule has ${ourMatches.length} matches`);

  const { mapping, unmatched } = buildMap(ourMatches, fdMatches);
  const matched = Object.keys(mapping).length;
  console.log(`Matched ${matched} / ${ourMatches.length}`);

  if (unmatched.length > 0) {
    console.log('\nUnmatched (skipped — likely KO slots or alias gaps):');
    for (const u of unmatched.slice(0, 20)) {
      const ours = `${u.our.team1} vs ${u.our.team2} on ${u.our.date}`;
      console.log(`  ${u.our.id}: ${ours}  [${u.reason}]`);
    }
    if (unmatched.length > 20) console.log(`  …and ${unmatched.length - 20} more`);
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(mapping, null, 2));
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
