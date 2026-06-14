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
