// Tournament logic ported from site/app.js with TS types and a
// parameterized score source (so we can render bracket cascades from
// either user predictions or admin-entered actuals).

import type {
  AdvancerMap,
  Group,
  KoMatch,
  ScoreMap,
  TournamentData,
} from './types';

export interface Standing {
  team: string;
  P: number;
  W: number;
  D: number;
  L: number;
  GF: number;
  GA: number;
  GD: number;
  Pts: number;
}

export function computeStandings(
  data: TournamentData,
  group: Group,
  scores: ScoreMap,
): Standing[] {
  // Track each team's position in the input `group.teams` array. This
  // is the FIFA-ranked order produced by build-data.py — when no
  // matches have been played (or two teams are exactly tied on every
  // metric), we preserve that order instead of falling through to an
  // alphabetical sort, which would put e.g. Argentina above the
  // higher-ranked Spain in an empty group.
  const seedOrder: Record<string, number> = {};
  group.teams.forEach((t, i) => { seedOrder[t] = i; });

  const teams: Record<string, Standing> = {};
  for (const t of group.teams) {
    teams[t] = { team: t, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
  }
  for (const m of data.group_matches[group.name] ?? []) {
    const sc = scores[m.id];
    if (!sc) continue;
    const a = teams[m.team1]; const b = teams[m.team2];
    if (!a || !b) continue;
    a.P++; b.P++;
    a.GF += sc.team1; a.GA += sc.team2;
    b.GF += sc.team2; b.GA += sc.team1;
    if (sc.team1 > sc.team2)      { a.W++; a.Pts += 3; b.L++; }
    else if (sc.team1 < sc.team2) { b.W++; b.Pts += 3; a.L++; }
    else                          { a.D++; b.D++; a.Pts++; b.Pts++; }
  }
  const list = Object.values(teams);
  for (const s of list) s.GD = s.GF - s.GA;
  list.sort((x, y) =>
    y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF || (seedOrder[x.team] - seedOrder[y.team]),
  );
  return list;
}

/**
 * Returns the third-placed team from each group, ranked. The top 8
 * advance to the Round of 32 in the actual 2026 format.
 */
export function getThirdPlacedRanking(
  data: TournamentData,
  scores: ScoreMap,
): Array<Standing & { group: string }> {
  const thirds: Array<Standing & { group: string }> = [];
  for (const g of data.groups) {
    const standings = computeStandings(data, g, scores);
    const third = standings[2];
    if (third && third.P > 0) thirds.push({ group: g.name, ...third });
  }
  thirds.sort((a, b) =>
    b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || a.team.localeCompare(b.team),
  );
  return thirds;
}

/**
 * Compute which teams are mathematically guaranteed to finish in the
 * top 2 of their group (qualified regardless of remaining results).
 * Brute-forces all possible outcomes for remaining matches.
 */
export function computeGuaranteedTop2(data: TournamentData, scores: ScoreMap): Set<string> {
  const guaranteed = new Set<string>();

  for (const g of data.groups) {
    const matches = data.group_matches[g.name] ?? [];
    const remaining = matches.filter(m => !scores[m.id]);
    if (remaining.length === 0) {
      // Group complete: top 2 are guaranteed
      const standings = computeStandings(data, g, scores);
      guaranteed.add(standings[0].team);
      guaranteed.add(standings[1].team);
      continue;
    }

    // Brute-force: check each team — are they top 2 in ALL scenarios?
    const outcomes: Array<[number, number]> = [[1, 0], [0, 0], [0, 1]];
    const totalCombinations = Math.pow(3, remaining.length);

    for (const team of g.teams) {
      let alwaysTop2 = true;
      for (let combo = 0; combo < totalCombinations; combo++) {
        const hypothetical: ScoreMap = { ...scores };
        let c = combo;
        for (let i = 0; i < remaining.length; i++) {
          const idx = c % 3;
          c = Math.floor(c / 3);
          hypothetical[remaining[i].id] = { team1: outcomes[idx][0], team2: outcomes[idx][1] };
        }
        const standings = computeStandings(data, g, hypothetical);
        if (standings[0].team !== team && standings[1].team !== team) {
          alwaysTop2 = false;
          break;
        }
      }
      if (alwaysTop2) guaranteed.add(team);
    }
  }

  return guaranteed;
}

/**
 * Compute which completed groups' 3rd-place teams are mathematically
 * guaranteed to qualify (top 8 best thirds).
 *
 * For each incomplete group, brute-forces all possible remaining match
 * outcomes to find the maximum points the eventual 3rd-place finisher
 * could achieve. Then checks if our team could be pushed out of top 8.
 */
export function computeSafeThirds(data: TournamentData, scores: ScoreMap): Set<string> {
  const safe = new Set<string>();
  const groupInfos = data.groups.map(g => {
    const standings = computeStandings(data, g, scores);
    const matches = data.group_matches[g.name] ?? [];
    const remaining = matches.filter(m => !scores[m.id]);
    return { group: g, standings, remaining };
  });

  // For each incomplete group, compute the max points a 3rd-place finisher could get
  const maxThirdPtsPerGroup: Record<string, number> = {};
  for (const { group, standings, remaining } of groupInfos) {
    if (remaining.length === 0) {
      // Complete: 3rd is fixed
      maxThirdPtsPerGroup[group.name] = standings[2]?.Pts ?? 0;
    } else {
      // Brute-force all outcomes
      maxThirdPtsPerGroup[group.name] = computeMaxThirdPoints(data, group, scores, remaining);
    }
  }

  // For each completed group's 3rd, check if they're safe
  for (const { group, standings, remaining } of groupInfos) {
    if (remaining.length > 0) continue; // Group not complete
    const third = standings[2];
    if (!third) continue;

    // Count groups that could produce a 3rd better than ours
    let couldBeatUs = 0;
    for (const otherInfo of groupInfos) {
      if (otherInfo.group.name === group.name) continue;
      const otherMaxThird = maxThirdPtsPerGroup[otherInfo.group.name];
      if (otherMaxThird > third.Pts) {
        couldBeatUs++;
      } else if (otherMaxThird === third.Pts) {
        // Equal points: could beat on GD in worst case
        // Be conservative — count as potential threat
        if (otherInfo.remaining.length > 0) couldBeatUs++;
        else {
          // Both complete: compare actual GD
          const otherThird = otherInfo.standings[2];
          if (otherThird && (otherThird.GD > third.GD || (otherThird.GD === third.GD && otherThird.GF > third.GF))) {
            couldBeatUs++;
          }
        }
      }
    }

    if (couldBeatUs < 8) {
      safe.add(group.name);
    }
  }

  return safe;
}

/**
 * Brute-force all possible outcomes for remaining matches in a group
 * and return the maximum points a 3rd-place finisher could achieve.
 */
function computeMaxThirdPoints(
  data: TournamentData,
  group: Group,
  existingScores: ScoreMap,
  remaining: Array<{ id: string; team1: string; team2: string }>,
): number {
  let maxThirdPts = 0;

  // Generate all possible outcomes: each match can be W(home), D, W(away)
  const outcomes = [
    [1, 0], // home win
    [0, 0], // draw
    [0, 1], // away win
  ];

  const numMatches = remaining.length;
  const totalCombinations = Math.pow(3, numMatches);

  for (let combo = 0; combo < totalCombinations; combo++) {
    // Build hypothetical scores
    const hypothetical: ScoreMap = { ...existingScores };
    let c = combo;
    for (let i = 0; i < numMatches; i++) {
      const outcomeIdx = c % 3;
      c = Math.floor(c / 3);
      const [h, a] = outcomes[outcomeIdx];
      hypothetical[remaining[i].id] = { team1: h, team2: a };
    }

    // Compute standings with this scenario
    const standings = computeStandings(data, group, hypothetical);
    const thirdPts = standings[2]?.Pts ?? 0;
    if (thirdPts > maxThirdPts) maxThirdPts = thirdPts;
  }

  return maxThirdPts;
}

/** Has every group played all 6 matches? Used to gate KO slot resolution. */
export function allGroupsCompleted(data: TournamentData, scores: ScoreMap): boolean {
  return data.groups.every(g => computeStandings(data, g, scores).every(t => t.P === 3));
}

/**
 * Resolve a KO slot token to a team name (or null if not yet determined).
 * Tokens:
 *   "1A" / "2B"        → group winner / runner-up
 *   "3A/B/C/D/F"       → top third-place finisher among listed groups
 *   "W74" / "L101"     → winner / loser of match #N
 *   plain team name    → returned as-is (defensive)
 */
export function resolveSlot(
  data: TournamentData,
  scores: ScoreMap,
  advancers: AdvancerMap,
  token: string,
): string | null {
  if (!token) return null;

  // Direct team name (later rounds may patch this)
  if (data.flag_map[token]) return token;

  const direct = /^([12])([A-L])$/.exec(token);
  if (direct) {
    const pos = parseInt(direct[1], 10) - 1;
    const gname = 'Group ' + direct[2];
    const group = data.groups.find(g => g.name === gname);
    if (!group) return null;
    const standings = computeStandings(data, group, scores);
    if (standings.every(t => t.P === 3)) return standings[pos]?.team ?? null;
    return null;
  }

  const thirdMatch = /^3([A-L/]+)$/.exec(token);
  if (thirdMatch) {
    if (!allGroupsCompleted(data, scores)) return null;
    const allowed = new Set(thirdMatch[1].split('/'));
    const ranking = getThirdPlacedRanking(data, scores);
    const top8 = ranking.slice(0, 8);
    for (const t of top8) {
      const letter = t.group.split(' ')[1];
      if (allowed.has(letter)) return t.team;
    }
    return null;
  }

  const wm = /^W(\d+)$/.exec(token);
  if (wm) return koWinner(data, scores, advancers, parseInt(wm[1], 10));
  const lm = /^L(\d+)$/.exec(token);
  if (lm) return koLoser(data, scores, advancers, parseInt(lm[1], 10));

  return null;
}

/**
 * Return the list of teams that could possibly fill a slot token.
 * Used to show candidates on KO match detail pages when teams aren't resolved yet.
 */
export function possibleTeamsForSlot(
  data: TournamentData,
  scores: ScoreMap,
  advancers: AdvancerMap,
  token: string,
): string[] {
  if (!token) return [];

  // Already resolved
  if (data.flag_map[token]) return [token];

  // "1E" or "2A" — position in group
  const direct = /^([12])([A-L])$/.exec(token);
  if (direct) {
    const pos = parseInt(direct[1], 10) - 1;
    const gname = 'Group ' + direct[2];
    const group = data.groups.find(g => g.name === gname);
    if (!group) return [];
    const standings = computeStandings(data, group, scores);
    // If group complete, it's definitive
    if (standings.every(t => t.P === 3)) return [standings[pos]?.team].filter(Boolean) as string[];
    // Otherwise, any team in the group could still finish in that position
    // Return current top candidates (sorted by current standings)
    if (pos === 0) return standings.slice(0, 2).map(t => t.team); // Top 2 could win
    return standings.slice(1, 4).map(t => t.team); // Positions 2-4 could be runner-up
  }

  // "3A/B/C/D/F" — best 3rd from listed groups
  const thirdMatch = /^3([A-L/]+)$/.exec(token);
  if (thirdMatch) {
    const allowed = new Set(thirdMatch[1].split('/'));
    // Get current 3rd-place teams from those groups
    const candidates: string[] = [];
    for (const g of data.groups) {
      const letter = g.name.split(' ')[1];
      if (!allowed.has(letter)) continue;
      const standings = computeStandings(data, g, scores);
      if (standings[2]) candidates.push(standings[2].team);
    }
    return candidates;
  }

  // "W73" — winner of match 73
  const wm = /^W(\d+)$/.exec(token);
  if (wm) {
    const num = parseInt(wm[1], 10);
    const winner = koWinner(data, scores, advancers, num);
    if (winner) return [winner];
    // Not yet resolved — get the two teams in that match
    const feeder = koMatchByNum(data, num);
    if (feeder) {
      const t1 = resolveSlot(data, scores, advancers, feeder.team1);
      const t2 = resolveSlot(data, scores, advancers, feeder.team2);
      return [t1, t2].filter(Boolean) as string[];
    }
    return [];
  }

  // "L73" — loser of match 73
  const lm = /^L(\d+)$/.exec(token);
  if (lm) {
    const num = parseInt(lm[1], 10);
    const loser = koLoser(data, scores, advancers, num);
    if (loser) return [loser];
    const feeder = koMatchByNum(data, num);
    if (feeder) {
      const t1 = resolveSlot(data, scores, advancers, feeder.team1);
      const t2 = resolveSlot(data, scores, advancers, feeder.team2);
      return [t1, t2].filter(Boolean) as string[];
    }
    return [];
  }

  return [];
}

function koMatchByNum(data: TournamentData, n: number): KoMatch | undefined {
  return data.ko_matches.find(m => m.num === n);
}

export function koWinner(
  data: TournamentData,
  scores: ScoreMap,
  advancers: AdvancerMap,
  num: number,
): string | null {
  const m = koMatchByNum(data, num);
  if (!m) return null;
  const t1 = resolveSlot(data, scores, advancers, m.team1);
  const t2 = resolveSlot(data, scores, advancers, m.team2);
  if (!t1 || !t2) return null;
  // Explicit advancer (handles ET/penalty draws) wins.
  const adv = advancers[m.id];
  if (adv === t1 || adv === t2) return adv;
  const sc = scores[m.id];
  if (!sc) return null;
  if (sc.team1 > sc.team2) return t1;
  if (sc.team2 > sc.team1) return t2;
  return null; // Tie without advancer override → unknown
}

export function koLoser(
  data: TournamentData,
  scores: ScoreMap,
  advancers: AdvancerMap,
  num: number,
): string | null {
  const m = koMatchByNum(data, num);
  if (!m) return null;
  const t1 = resolveSlot(data, scores, advancers, m.team1);
  const t2 = resolveSlot(data, scores, advancers, m.team2);
  if (!t1 || !t2) return null;
  const adv = advancers[m.id];
  if (adv === t1) return t2;
  if (adv === t2) return t1;
  const sc = scores[m.id];
  if (!sc) return null;
  if (sc.team1 < sc.team2) return t1;
  if (sc.team2 < sc.team1) return t2;
  return null;
}

/** Human-readable label for a slot token, used as placeholder in KO cards. */
export function prettySlot(token: string): string {
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

export function isKnockoutRound(round: string): boolean {
  return (
    round === 'Round of 32' ||
    round === 'Round of 16' ||
    round === 'Quarter-final' ||
    round === 'Semi-final' ||
    round === 'Match for third place' ||
    round === 'Final'
  );
}
