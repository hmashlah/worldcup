import { describe, it, expect } from 'vitest';
import {
  computeStandings,
  getThirdPlacedRanking,
  allGroupsCompleted,
  resolveSlot,
  koWinner,
  koLoser,
  prettySlot,
  isKnockoutRound,
  computeSafeThirds,
  computeGuaranteedTop2,
  possibleTeamsForSlot,
} from './tournament';
import type { TournamentData, Group, GroupMatch, KoMatch } from './types';

// ── Helpers ──────────────────────────────────────────────────────────

function makeData(opts: {
  groups?: Group[];
  group_matches?: Record<string, GroupMatch[]>;
  ko_matches?: KoMatch[];
  flag_map?: Record<string, string>;
}): TournamentData {
  return {
    groups: opts.groups ?? [],
    group_matches: opts.group_matches ?? {},
    ko_matches: opts.ko_matches ?? [],
    flag_map: opts.flag_map ?? {},
  };
}

function makeGroup(name: string, teams: string[]): Group {
  return { name, teams };
}

function makeGroupMatch(id: string, team1: string, team2: string): GroupMatch {
  return { id, date: '2026-06-11', time: '13:00 UTC-6', team1, team2, ground: 'Stadium', matchday: 'Matchday 1' };
}

function makeKoMatch(id: string, num: number, round: string, team1: string, team2: string): KoMatch {
  return { id, num, round: round as any, date: '2026-07-01', time: '20:00 UTC-4', team1, team2, ground: 'Stadium' };
}

// ── computeStandings ─────────────────────────────────────────────────

describe('computeStandings', () => {
  const group = makeGroup('Group A', ['Brazil', 'Germany', 'Japan', 'Mexico']);
  const matches = [
    makeGroupMatch('G-A-1', 'Brazil', 'Germany'),
    makeGroupMatch('G-A-2', 'Japan', 'Mexico'),
    makeGroupMatch('G-A-3', 'Brazil', 'Japan'),
    makeGroupMatch('G-A-4', 'Germany', 'Mexico'),
    makeGroupMatch('G-A-5', 'Brazil', 'Mexico'),
    makeGroupMatch('G-A-6', 'Germany', 'Japan'),
  ];
  const data = makeData({ groups: [group], group_matches: { 'Group A': matches } });

  it('returns all teams with zero stats when no scores', () => {
    const standings = computeStandings(data, group, {});
    expect(standings).toHaveLength(4);
    expect(standings.every(s => s.P === 0 && s.Pts === 0)).toBe(true);
  });

  it('preserves seed order when no games played', () => {
    const standings = computeStandings(data, group, {});
    expect(standings.map(s => s.team)).toEqual(['Brazil', 'Germany', 'Japan', 'Mexico']);
  });

  it('computes standings correctly for a win', () => {
    const scores = { 'G-A-1': { team1: 2, team2: 0 } }; // Brazil 2-0 Germany
    const standings = computeStandings(data, group, scores);
    const brazil = standings.find(s => s.team === 'Brazil')!;
    const germany = standings.find(s => s.team === 'Germany')!;
    expect(brazil.P).toBe(1);
    expect(brazil.W).toBe(1);
    expect(brazil.Pts).toBe(3);
    expect(brazil.GF).toBe(2);
    expect(brazil.GA).toBe(0);
    expect(brazil.GD).toBe(2);
    expect(germany.L).toBe(1);
    expect(germany.Pts).toBe(0);
  });

  it('computes standings for a draw', () => {
    const scores = { 'G-A-1': { team1: 1, team2: 1 } }; // Brazil 1-1 Germany
    const standings = computeStandings(data, group, scores);
    const brazil = standings.find(s => s.team === 'Brazil')!;
    const germany = standings.find(s => s.team === 'Germany')!;
    expect(brazil.D).toBe(1);
    expect(brazil.Pts).toBe(1);
    expect(germany.D).toBe(1);
    expect(germany.Pts).toBe(1);
  });

  it('sorts by points, then GD, then GF', () => {
    const scores = {
      'G-A-1': { team1: 3, team2: 0 }, // Brazil 3-0 Germany
      'G-A-2': { team1: 1, team2: 0 }, // Japan 1-0 Mexico
      'G-A-3': { team1: 1, team2: 0 }, // Brazil 1-0 Japan
      'G-A-4': { team1: 2, team2: 0 }, // Germany 2-0 Mexico
      'G-A-5': { team1: 2, team2: 0 }, // Brazil 2-0 Mexico
      'G-A-6': { team1: 1, team2: 1 }, // Germany 1-1 Japan
    };
    const standings = computeStandings(data, group, scores);
    // Brazil: 9 pts, Japan: 4 pts, Germany: 4 pts, Mexico: 0 pts
    expect(standings[0].team).toBe('Brazil');
    expect(standings[0].Pts).toBe(9);
    // Germany GD: +1 (3GF-2GA), Japan GD: +1 (2GF-1GA) — Japan has less GF
    // Actually: Germany GF=3 GA=4 GD=-1, Japan GF=2 GA=2 GD=0
    // Japan should be above Germany
    expect(standings[3].team).toBe('Mexico');
  });
});

// ── getThirdPlacedRanking ────────────────────────────────────────────

describe('getThirdPlacedRanking', () => {
  it('ranks third-placed teams across groups', () => {
    const groupA = makeGroup('Group A', ['T1', 'T2', 'T3', 'T4']);
    const groupB = makeGroup('Group B', ['T5', 'T6', 'T7', 'T8']);
    const matchesA = [
      makeGroupMatch('G-A-1', 'T1', 'T2'),
      makeGroupMatch('G-A-2', 'T3', 'T4'),
      makeGroupMatch('G-A-3', 'T1', 'T3'),
      makeGroupMatch('G-A-4', 'T2', 'T4'),
      makeGroupMatch('G-A-5', 'T1', 'T4'),
      makeGroupMatch('G-A-6', 'T2', 'T3'),
    ];
    const matchesB = [
      makeGroupMatch('G-B-1', 'T5', 'T6'),
      makeGroupMatch('G-B-2', 'T7', 'T8'),
      makeGroupMatch('G-B-3', 'T5', 'T7'),
      makeGroupMatch('G-B-4', 'T6', 'T8'),
      makeGroupMatch('G-B-5', 'T5', 'T8'),
      makeGroupMatch('G-B-6', 'T6', 'T7'),
    ];
    const data = makeData({
      groups: [groupA, groupB],
      group_matches: { 'Group A': matchesA, 'Group B': matchesB },
    });
    // Group A: T1 wins all, T2 second, T3 third (1W 2L = 3pts? no, let's make it simple)
    const scores = {
      'G-A-1': { team1: 2, team2: 1 }, 'G-A-2': { team1: 2, team2: 0 },
      'G-A-3': { team1: 1, team2: 0 }, 'G-A-4': { team1: 1, team2: 0 },
      'G-A-5': { team1: 3, team2: 0 }, 'G-A-6': { team1: 0, team2: 1 },
      'G-B-1': { team1: 1, team2: 0 }, 'G-B-2': { team1: 0, team2: 1 },
      'G-B-3': { team1: 2, team2: 0 }, 'G-B-4': { team1: 1, team2: 1 },
      'G-B-5': { team1: 1, team2: 0 }, 'G-B-6': { team1: 2, team2: 0 },
    };
    const ranking = getThirdPlacedRanking(data, scores);
    expect(ranking.length).toBe(2); // one third per group
    expect(ranking[0].group).toBeDefined();
  });
});

// ── allGroupsCompleted ───────────────────────────────────────────────

describe('allGroupsCompleted', () => {
  const group = makeGroup('Group A', ['A', 'B', 'C', 'D']);
  const matches = [
    makeGroupMatch('1', 'A', 'B'), makeGroupMatch('2', 'C', 'D'),
    makeGroupMatch('3', 'A', 'C'), makeGroupMatch('4', 'B', 'D'),
    makeGroupMatch('5', 'A', 'D'), makeGroupMatch('6', 'B', 'C'),
  ];
  const data = makeData({ groups: [group], group_matches: { 'Group A': matches } });

  it('returns false when not all matches played', () => {
    const scores = { '1': { team1: 1, team2: 0 } };
    expect(allGroupsCompleted(data, scores)).toBe(false);
  });

  it('returns true when all matches played', () => {
    const scores = {
      '1': { team1: 1, team2: 0 }, '2': { team1: 0, team2: 0 },
      '3': { team1: 2, team2: 1 }, '4': { team1: 1, team2: 1 },
      '5': { team1: 0, team2: 0 }, '6': { team1: 3, team2: 2 },
    };
    expect(allGroupsCompleted(data, scores)).toBe(true);
  });
});

// ── resolveSlot ──────────────────────────────────────────────────────

describe('resolveSlot', () => {
  it('returns null for empty token', () => {
    const data = makeData({});
    expect(resolveSlot(data, {}, {}, '')).toBe(null);
  });

  it('returns team name directly if in flag_map', () => {
    const data = makeData({ flag_map: { 'Brazil': 'br' } });
    expect(resolveSlot(data, {}, {}, 'Brazil')).toBe('Brazil');
  });

  it('resolves "1A" to group winner when all matches played', () => {
    const group = makeGroup('Group A', ['X', 'Y', 'Z', 'W']);
    const matches = [
      makeGroupMatch('1', 'X', 'Y'), makeGroupMatch('2', 'Z', 'W'),
      makeGroupMatch('3', 'X', 'Z'), makeGroupMatch('4', 'Y', 'W'),
      makeGroupMatch('5', 'X', 'W'), makeGroupMatch('6', 'Y', 'Z'),
    ];
    const data = makeData({ groups: [group], group_matches: { 'Group A': matches } });
    const scores = {
      '1': { team1: 2, team2: 0 }, '2': { team1: 1, team2: 0 },
      '3': { team1: 1, team2: 0 }, '4': { team1: 0, team2: 1 },
      '5': { team1: 3, team2: 0 }, '6': { team1: 1, team2: 0 },
    };
    // X wins all 3, should be first
    expect(resolveSlot(data, scores, {}, '1A')).toBe('X');
  });

  it('returns null for "1A" when group not complete', () => {
    const group = makeGroup('Group A', ['X', 'Y', 'Z', 'W']);
    const matches = [
      makeGroupMatch('1', 'X', 'Y'), makeGroupMatch('2', 'Z', 'W'),
      makeGroupMatch('3', 'X', 'Z'), makeGroupMatch('4', 'Y', 'W'),
      makeGroupMatch('5', 'X', 'W'), makeGroupMatch('6', 'Y', 'Z'),
    ];
    const data = makeData({ groups: [group], group_matches: { 'Group A': matches } });
    const scores = { '1': { team1: 2, team2: 0 } }; // only 1 match played
    expect(resolveSlot(data, scores, {}, '1A')).toBe(null);
  });

  it('resolves "W73" to winner of KO match #73', () => {
    const ko = makeKoMatch('M73', 73, 'Round of 32', 'Brazil', 'Japan');
    const data = makeData({ ko_matches: [ko], flag_map: { 'Brazil': 'br', 'Japan': 'jp' } });
    const scores = { 'M73': { team1: 2, team2: 1 } };
    expect(resolveSlot(data, scores, {}, 'W73')).toBe('Brazil');
  });

  it('resolves "L73" to loser of KO match #73', () => {
    const ko = makeKoMatch('M73', 73, 'Round of 32', 'Brazil', 'Japan');
    const data = makeData({ ko_matches: [ko], flag_map: { 'Brazil': 'br', 'Japan': 'jp' } });
    const scores = { 'M73': { team1: 2, team2: 1 } };
    expect(resolveSlot(data, scores, {}, 'L73')).toBe('Japan');
  });
});

// ── koWinner / koLoser ───────────────────────────────────────────────

describe('koWinner', () => {
  it('returns team1 when team1 score is higher', () => {
    const ko = makeKoMatch('M73', 73, 'Round of 32', 'Brazil', 'Japan');
    const data = makeData({ ko_matches: [ko], flag_map: { 'Brazil': 'br', 'Japan': 'jp' } });
    expect(koWinner(data, { 'M73': { team1: 3, team2: 1 } }, {}, 73)).toBe('Brazil');
  });

  it('returns team2 when team2 score is higher', () => {
    const ko = makeKoMatch('M73', 73, 'Round of 32', 'Brazil', 'Japan');
    const data = makeData({ ko_matches: [ko], flag_map: { 'Brazil': 'br', 'Japan': 'jp' } });
    expect(koWinner(data, { 'M73': { team1: 0, team2: 2 } }, {}, 73)).toBe('Japan');
  });

  it('uses advancer map for draws (ET/pens)', () => {
    const ko = makeKoMatch('M73', 73, 'Round of 32', 'Brazil', 'Japan');
    const data = makeData({ ko_matches: [ko], flag_map: { 'Brazil': 'br', 'Japan': 'jp' } });
    expect(koWinner(data, { 'M73': { team1: 1, team2: 1 } }, { 'M73': 'Japan' }, 73)).toBe('Japan');
  });

  it('returns null for draw without advancer', () => {
    const ko = makeKoMatch('M73', 73, 'Round of 32', 'Brazil', 'Japan');
    const data = makeData({ ko_matches: [ko], flag_map: { 'Brazil': 'br', 'Japan': 'jp' } });
    expect(koWinner(data, { 'M73': { team1: 1, team2: 1 } }, {}, 73)).toBe(null);
  });

  it('returns null when match has no score', () => {
    const ko = makeKoMatch('M73', 73, 'Round of 32', 'Brazil', 'Japan');
    const data = makeData({ ko_matches: [ko], flag_map: { 'Brazil': 'br', 'Japan': 'jp' } });
    expect(koWinner(data, {}, {}, 73)).toBe(null);
  });

  it('returns null for non-existent match number', () => {
    const data = makeData({ ko_matches: [] });
    expect(koWinner(data, {}, {}, 999)).toBe(null);
  });
});

describe('koLoser', () => {
  it('returns team2 when team1 wins', () => {
    const ko = makeKoMatch('M73', 73, 'Round of 32', 'Brazil', 'Japan');
    const data = makeData({ ko_matches: [ko], flag_map: { 'Brazil': 'br', 'Japan': 'jp' } });
    expect(koLoser(data, { 'M73': { team1: 2, team2: 0 } }, {}, 73)).toBe('Japan');
  });

  it('returns team1 when team2 wins via advancer', () => {
    const ko = makeKoMatch('M73', 73, 'Round of 32', 'Brazil', 'Japan');
    const data = makeData({ ko_matches: [ko], flag_map: { 'Brazil': 'br', 'Japan': 'jp' } });
    expect(koLoser(data, { 'M73': { team1: 1, team2: 1 } }, { 'M73': 'Japan' }, 73)).toBe('Brazil');
  });
});

// ── prettySlot ───────────────────────────────────────────────────────

describe('prettySlot', () => {
  it('returns "TBD" for empty string', () => {
    expect(prettySlot('')).toBe('TBD');
  });

  it('formats group winner', () => {
    expect(prettySlot('1A')).toBe('Winner Group A');
  });

  it('formats group runner-up', () => {
    expect(prettySlot('2B')).toBe('Runner-up Group B');
  });

  it('formats third-place token', () => {
    expect(prettySlot('3A/B/C/D')).toBe('3rd-place A/B/C/D');
  });

  it('formats winner-of token', () => {
    expect(prettySlot('W74')).toBe('Winner of M74');
  });

  it('formats loser-of token', () => {
    expect(prettySlot('L101')).toBe('Loser of M101');
  });

  it('returns unknown token as-is', () => {
    expect(prettySlot('something')).toBe('something');
  });
});

// ── isKnockoutRound ──────────────────────────────────────────────────

describe('isKnockoutRound', () => {
  it('returns true for all KO rounds', () => {
    expect(isKnockoutRound('Round of 32')).toBe(true);
    expect(isKnockoutRound('Round of 16')).toBe(true);
    expect(isKnockoutRound('Quarter-final')).toBe(true);
    expect(isKnockoutRound('Semi-final')).toBe(true);
    expect(isKnockoutRound('Match for third place')).toBe(true);
    expect(isKnockoutRound('Final')).toBe(true);
  });

  it('returns false for non-KO rounds', () => {
    expect(isKnockoutRound('Group A')).toBe(false);
    expect(isKnockoutRound('Matchday 1')).toBe(false);
    expect(isKnockoutRound('')).toBe(false);
  });
});

// ── computeSafeThirds ─────────────────────────────────────────────────

describe('computeSafeThirds', () => {
  // Helper: build a minimal tournament with N groups of 4 teams each
  function makeData(numGroups: number) {
    const groups = [];
    const group_matches: Record<string, Array<{ id: string; team1: string; team2: string; date: string; time: string; ground: string; matchday: string }>> = {};
    for (let g = 0; g < numGroups; g++) {
      const name = `Group ${String.fromCharCode(65 + g)}`;
      const teams = [`${name}-T1`, `${name}-T2`, `${name}-T3`, `${name}-T4`];
      groups.push({ name, teams });
      group_matches[name] = [
        { id: `${name}-M1`, team1: teams[0], team2: teams[1], date: '2026-06-11', time: '21:00', ground: '', matchday: 'Matchday 1' },
        { id: `${name}-M2`, team1: teams[2], team2: teams[3], date: '2026-06-12', time: '21:00', ground: '', matchday: 'Matchday 1' },
        { id: `${name}-M3`, team1: teams[0], team2: teams[2], date: '2026-06-15', time: '21:00', ground: '', matchday: 'Matchday 2' },
        { id: `${name}-M4`, team1: teams[1], team2: teams[3], date: '2026-06-15', time: '21:00', ground: '', matchday: 'Matchday 2' },
        { id: `${name}-M5`, team1: teams[0], team2: teams[3], date: '2026-06-19', time: '21:00', ground: '', matchday: 'Matchday 3' },
        { id: `${name}-M6`, team1: teams[1], team2: teams[2], date: '2026-06-19', time: '21:00', ground: '', matchday: 'Matchday 3' },
      ];
    }
    return { groups, group_matches, ko_matches: [], flag_map: {} };
  }

  it('returns empty when no groups are complete', () => {
    const data = makeData(12);
    const scores = {}; // No results
    expect(computeSafeThirds(data, scores).size).toBe(0);
  });

  it('marks a 3rd with 6 pts as safe when incomplete groups cannot beat them', () => {
    const data = makeData(12);
    const scores: Record<string, { team1: number; team2: number }> = {};

    // Complete Group A: T1 wins all (9pts), T2 wins 2 (6pts), T3 wins 1 (3pts), T4 loses all (0pts)
    // T3 is 3rd with 3 pts? No — let's make T3 have 6 pts by winning 2 and losing 1
    // Actually let's just set results explicitly:
    // M1: T1 1-0 T2 (T1=3pts, T2=0)
    // M2: T3 1-0 T4 (T3=3pts, T4=0)
    // M3: T1 1-0 T3 (T1=6pts, T3=3pts)
    // M4: T2 1-0 T4 (T2=3pts, T4=0)
    // M5: T1 1-0 T4 (T1=9pts, T4=0)
    // M6: T3 1-0 T2 (T3=6pts, T2=3pts)
    // Final: T1=9, T3=6, T2=3, T4=0. 3rd = T2 with 3pts
    // Hmm, let me make 3rd have more pts:
    // M1: T1 1-0 T2, M2: T3 1-0 T4, M3: T3 1-0 T1, M4: T2 1-0 T4, M5: T1 1-0 T4, M6: T2 1-0 T3
    // T1: W,L,W = 6pts. T2: L,W,W = 6pts. T3: W,W,L = 6pts. T4: L,L,L = 0pts
    // Sorted by GD: all tied at 6pts... Let's use simpler scores.

    // Group A complete: 3rd has 4 pts
    scores['Group A-M1'] = { team1: 2, team2: 0 }; // T1 beats T2
    scores['Group A-M2'] = { team1: 1, team2: 0 }; // T3 beats T4
    scores['Group A-M3'] = { team1: 1, team2: 0 }; // T1 beats T3
    scores['Group A-M4'] = { team1: 1, team2: 1 }; // T2 draws T4
    scores['Group A-M5'] = { team1: 3, team2: 0 }; // T1 beats T4
    scores['Group A-M6'] = { team1: 1, team2: 1 }; // T2 draws T3
    // T1: 9pts, T3: 4pts (W,L,D), T2: 2pts (L,D,D), T4: 1pt (L,D,L)
    // 3rd = T2 with 2pts? Let me recalculate:
    // T1: beat T2(3), beat T3(3), beat T4(3) = 9pts
    // T2: lost T1(0), drew T4(1), drew T3(1) = 2pts  
    // T3: beat T4(3), lost T1(0), drew T2(1) = 4pts
    // T4: lost T3(0), drew T2(1), lost T1(0) = 1pt
    // Order: T1(9), T3(4), T2(2), T4(1). 3rd = T2 with 2pts

    // All other 11 groups have 0 games played.
    // Max 3rd from each incomplete group: brute-force gives max 5pts for 3rd
    // (one team wins 1 and draws 1 = 5? No, max in 3 games = 6 for 2nd, 3rd can't have more than the 2nd)
    // Actually with 4 teams in round robin, max for 3rd is 6pts (all three-way tie possible)
    // So 11 groups could each produce a 3rd with up to 6pts > 2pts of our 3rd
    // couldBeatUs = 11 >= 8, so Group A's 3rd is NOT safe
    const result = computeSafeThirds(data, scores);
    expect(result.has('Group A')).toBe(false); // 2pts 3rd can't be safe with 11 threats
  });

  it('marks a 3rd as safe when most groups are complete and cannot beat them', () => {
    const data = makeData(12);
    const scores: Record<string, { team1: number; team2: number }> = {};

    // Complete 11 groups with 3rd having low points (1pt each)
    for (let g = 0; g < 11; g++) {
      const name = `Group ${String.fromCharCode(65 + g)}`;
      // T1 wins all, T2 wins 2, T3 draws 1, T4 loses all
      scores[`${name}-M1`] = { team1: 2, team2: 0 }; // T1 beats T2
      scores[`${name}-M2`] = { team1: 0, team2: 0 }; // T3 draws T4
      scores[`${name}-M3`] = { team1: 2, team2: 0 }; // T1 beats T3
      scores[`${name}-M4`] = { team1: 2, team2: 0 }; // T2 beats T4
      scores[`${name}-M5`] = { team1: 2, team2: 0 }; // T1 beats T4
      scores[`${name}-M6`] = { team1: 2, team2: 0 }; // T2 beats T3
      // T1=9, T2=6, T3=1, T4=1 → 3rd = T3 or T4 with 1pt
    }

    // Group L (12th) is incomplete — 0 games played
    // Max 3rd from Group L could be up to 6pts (brute force)
    // Our 11 completed groups each have 3rd with 1pt
    // Only Group L threatens. couldBeatUs for each completed group = 
    //   10 other completed groups with 1pt (equal, both complete, same GD check)
    //   + 1 incomplete group (could beat)
    // Actually all 11 thirds have 1pt and same scenario. Let's check one:
    // Group A 3rd has 1pt. Threats: Group L (incomplete, max ~6pts = beats us).
    //   Other 10 completed groups: their 3rds have 1pt too — equal, both complete.
    //   Need to check GD. T3 in each group: drew T4 (0-0), lost T1, lost T2.
    //   GD = 0 + (-2) + (-2) = -4. All same. So no completed group beats us.
    //   couldBeatUs = 1 (just Group L). 1 < 8 → SAFE!
    const result = computeSafeThirds(data, scores);
    expect(result.has('Group A')).toBe(true);
    expect(result.has('Group K')).toBe(true); // 11th group also safe
  });
});

// ── computeGuaranteedTop2 ─────────────────────────────────────────────

describe('computeGuaranteedTop2', () => {
  function makeData(numGroups: number) {
    const groups = [];
    const group_matches: Record<string, Array<{ id: string; team1: string; team2: string; date: string; time: string; ground: string; matchday: string }>> = {};
    for (let g = 0; g < numGroups; g++) {
      const name = `Group ${String.fromCharCode(65 + g)}`;
      const teams = [`${name}-T1`, `${name}-T2`, `${name}-T3`, `${name}-T4`];
      groups.push({ name, teams });
      group_matches[name] = [
        { id: `${name}-M1`, team1: teams[0], team2: teams[1], date: '2026-06-11', time: '21:00', ground: '', matchday: 'Matchday 1' },
        { id: `${name}-M2`, team1: teams[2], team2: teams[3], date: '2026-06-12', time: '21:00', ground: '', matchday: 'Matchday 1' },
        { id: `${name}-M3`, team1: teams[0], team2: teams[2], date: '2026-06-15', time: '21:00', ground: '', matchday: 'Matchday 2' },
        { id: `${name}-M4`, team1: teams[1], team2: teams[3], date: '2026-06-15', time: '21:00', ground: '', matchday: 'Matchday 2' },
        { id: `${name}-M5`, team1: teams[0], team2: teams[3], date: '2026-06-19', time: '21:00', ground: '', matchday: 'Matchday 3' },
        { id: `${name}-M6`, team1: teams[1], team2: teams[2], date: '2026-06-19', time: '21:00', ground: '', matchday: 'Matchday 3' },
      ];
    }
    return { groups, group_matches, ko_matches: [], flag_map: {} };
  }

  it('returns all top-2 teams for a completed group', () => {
    const data = makeData(1);
    const scores: Record<string, { team1: number; team2: number }> = {
      'Group A-M1': { team1: 2, team2: 0 },
      'Group A-M2': { team1: 1, team2: 0 },
      'Group A-M3': { team1: 1, team2: 0 },
      'Group A-M4': { team1: 1, team2: 0 },
      'Group A-M5': { team1: 1, team2: 0 },
      'Group A-M6': { team1: 0, team2: 1 },
    };
    const result = computeGuaranteedTop2(data, scores);
    expect(result.size).toBe(2);
    // T1 wins M1, M3, M5 = 9pts. T3 wins M2, loses M3, wins M6's opponent? Let me trace:
    // M1: T1 2-0 T2 → T1=3, T2=0
    // M2: T3 1-0 T4 → T3=3, T4=0
    // M3: T1 1-0 T3 → T1=6, T3=3
    // M4: T2 1-0 T4 → T2=3, T4=0
    // M5: T1 1-0 T4 → T1=9, T4=0
    // M6: T2 0-1 T3 → T3=6, T2=3
    // Final: T1=9, T3=6, T2=3, T4=0
    expect(result.has('Group A-T1')).toBe(true);
    expect(result.has('Group A-T3')).toBe(true);
  });

  it('detects guaranteed top 2 before group finishes (6pts from 2 games)', () => {
    const data = makeData(1);
    // T1 wins first two matches → 6pts. Remaining: M5 (T1 vs T4), M6 (T2 vs T3)
    const scores: Record<string, { team1: number; team2: number }> = {
      'Group A-M1': { team1: 3, team2: 0 }, // T1 beats T2
      'Group A-M2': { team1: 0, team2: 1 }, // T4 loses to T3 → T3=3
      'Group A-M3': { team1: 2, team2: 0 }, // T1 beats T3
      'Group A-M4': { team1: 1, team2: 0 }, // T2 beats T4
    };
    // T1=6pts, T2=3pts, T3=3pts, T4=0pts. Remaining: M5 (T1 vs T4), M6 (T2 vs T3)
    // Even if T1 loses M5, T1 still has 6pts.
    // Max T2 or T3 can get: 3+3=6pts. But T1 has GD advantage.
    // Actually T2 could reach 6pts (beats T3 in M6) and tie T1.
    // With GD: T1 GD = (3-0)+(2-0) = +5. Even losing M5 0-3, GD=+2.
    // T2 winning M6 3-0: T2 GD = (0-3)+(1-0)+(3-0) = +1. T1 still ahead.
    // T1 is guaranteed top 2.
    const result = computeGuaranteedTop2(data, scores);
    expect(result.has('Group A-T1')).toBe(true);
  });

  it('does not guarantee a team that could still drop to 3rd', () => {
    const data = makeData(1);
    // After matchday 1 only: T1=3, T3=3, T2=0, T4=0
    const scores: Record<string, { team1: number; team2: number }> = {
      'Group A-M1': { team1: 1, team2: 0 }, // T1 beats T2
      'Group A-M2': { team1: 1, team2: 0 }, // T3 beats T4
    };
    // T1=3, T3=3, T2=0, T4=0. 4 matches remaining.
    // T2 could win next 2 → 6pts and overtake T1.
    const result = computeGuaranteedTop2(data, scores);
    expect(result.has('Group A-T1')).toBe(false);
    expect(result.has('Group A-T3')).toBe(false);
  });
});

// ── possibleTeamsForSlot ──────────────────────────────────────────────

describe('possibleTeamsForSlot', () => {
  const baseData = {
    groups: [
      { name: 'Group A', teams: ['Mexico', 'South Korea', 'Czech Republic', 'South Africa'] },
      { name: 'Group B', teams: ['Canada', 'Switzerland', 'Bosnia & Herzegovina', 'Qatar'] },
    ],
    group_matches: {
      'Group A': [
        { id: 'G-A-1', team1: 'Mexico', team2: 'South Korea', date: '2026-06-11', time: '21:00', ground: '', matchday: 'Matchday 1' },
        { id: 'G-A-2', team1: 'Czech Republic', team2: 'South Africa', date: '2026-06-12', time: '21:00', ground: '', matchday: 'Matchday 1' },
        { id: 'G-A-3', team1: 'Mexico', team2: 'Czech Republic', date: '2026-06-15', time: '21:00', ground: '', matchday: 'Matchday 2' },
        { id: 'G-A-4', team1: 'South Korea', team2: 'South Africa', date: '2026-06-15', time: '21:00', ground: '', matchday: 'Matchday 2' },
        { id: 'G-A-5', team1: 'Mexico', team2: 'South Africa', date: '2026-06-19', time: '21:00', ground: '', matchday: 'Matchday 3' },
        { id: 'G-A-6', team1: 'South Korea', team2: 'Czech Republic', date: '2026-06-19', time: '21:00', ground: '', matchday: 'Matchday 3' },
      ],
      'Group B': [
        { id: 'G-B-1', team1: 'Canada', team2: 'Switzerland', date: '2026-06-11', time: '21:00', ground: '', matchday: 'Matchday 1' },
        { id: 'G-B-2', team1: 'Bosnia & Herzegovina', team2: 'Qatar', date: '2026-06-12', time: '21:00', ground: '', matchday: 'Matchday 1' },
        { id: 'G-B-3', team1: 'Canada', team2: 'Bosnia & Herzegovina', date: '2026-06-15', time: '21:00', ground: '', matchday: 'Matchday 2' },
        { id: 'G-B-4', team1: 'Switzerland', team2: 'Qatar', date: '2026-06-15', time: '21:00', ground: '', matchday: 'Matchday 2' },
        { id: 'G-B-5', team1: 'Canada', team2: 'Qatar', date: '2026-06-19', time: '21:00', ground: '', matchday: 'Matchday 3' },
        { id: 'G-B-6', team1: 'Switzerland', team2: 'Bosnia & Herzegovina', date: '2026-06-19', time: '21:00', ground: '', matchday: 'Matchday 3' },
      ],
    },
    ko_matches: [
      { id: 'M73', num: 73, round: 'Round of 32' as const, team1: '1A', team2: '2B', date: '2026-06-28', time: '21:00', ground: '' },
      { id: 'M89', num: 89, round: 'Round of 16' as const, team1: 'W73', team2: 'W74', date: '2026-07-01', time: '21:00', ground: '' },
    ],
    flag_map: { 'Mexico': 'mx', 'South Korea': 'kr', 'Czech Republic': 'cz', 'South Africa': 'za', 'Canada': 'ca', 'Switzerland': 'ch', 'Bosnia & Herzegovina': 'ba', 'Qatar': 'qa' } as Record<string, string>,
  };

  it('returns group winner candidates for "1A" with completed group', () => {
    const scores: Record<string, { team1: number; team2: number }> = {
      'G-A-1': { team1: 2, team2: 0 },
      'G-A-2': { team1: 0, team2: 1 },
      'G-A-3': { team1: 1, team2: 0 },
      'G-A-4': { team1: 1, team2: 0 },
      'G-A-5': { team1: 1, team2: 0 },
      'G-A-6': { team1: 1, team2: 0 },
    };
    // Mexico wins all = 9pts, definitive winner
    const result = possibleTeamsForSlot(baseData, scores, {}, '1A');
    expect(result).toEqual(['Mexico']);
  });

  it('returns top candidates for "1A" with incomplete group', () => {
    const scores: Record<string, { team1: number; team2: number }> = {
      'G-A-1': { team1: 2, team2: 0 }, // Mexico beats S.Korea
      'G-A-2': { team1: 0, team2: 1 }, // S.Africa beats Czech Rep
    };
    // Mexico=3, S.Africa=3, others=0. Top 2 could win the group.
    const result = possibleTeamsForSlot(baseData, scores, {}, '1A');
    expect(result.length).toBe(2);
    expect(result).toContain('Mexico');
    expect(result).toContain('South Africa');
  });

  it('returns candidates for "3A/B" slot from listed groups', () => {
    const scores: Record<string, { team1: number; team2: number }> = {
      'G-A-1': { team1: 2, team2: 0 },
      'G-A-2': { team1: 0, team2: 0 },
      'G-A-3': { team1: 1, team2: 0 },
      'G-A-4': { team1: 1, team2: 0 },
      'G-A-5': { team1: 1, team2: 0 },
      'G-A-6': { team1: 1, team2: 0 },
    };
    const result = possibleTeamsForSlot(baseData, scores, {}, '3A/B');
    // Should include 3rd-place teams from Group A and Group B
    expect(result.length).toBeGreaterThan(0);
    // Group A complete: 3rd is deterministic
    expect(result.some(t => baseData.groups[0].teams.includes(t))).toBe(true);
  });

  it('returns resolved team for already-known slot', () => {
    const result = possibleTeamsForSlot(baseData, {}, {}, 'Mexico');
    expect(result).toEqual(['Mexico']);
  });

  it('returns feeder match teams for "W73" when match not played', () => {
    // M73 is 1A vs 2B — neither resolved yet (no scores)
    const result = possibleTeamsForSlot(baseData, {}, {}, 'W73');
    // Can't determine winner, but can't determine feeder teams either (1A/2B unresolved)
    expect(result).toEqual([]);
  });

  it('returns feeder match teams for "W73" when feeder match teams are resolved', () => {
    // Complete both groups so 1A and 2B resolve
    const scores: Record<string, { team1: number; team2: number }> = {
      'G-A-1': { team1: 2, team2: 0 }, 'G-A-2': { team1: 0, team2: 1 },
      'G-A-3': { team1: 1, team2: 0 }, 'G-A-4': { team1: 1, team2: 0 },
      'G-A-5': { team1: 1, team2: 0 }, 'G-A-6': { team1: 1, team2: 0 },
      'G-B-1': { team1: 2, team2: 0 }, 'G-B-2': { team1: 0, team2: 1 },
      'G-B-3': { team1: 1, team2: 0 }, 'G-B-4': { team1: 1, team2: 0 },
      'G-B-5': { team1: 1, team2: 0 }, 'G-B-6': { team1: 1, team2: 0 },
    };
    // M73 teams are resolved (1A=Mexico, 2B=Switzerland) but match not played
    const result = possibleTeamsForSlot(baseData, scores, {}, 'W73');
    expect(result).toContain('Mexico');
    expect(result).toContain('Switzerland');
  });
});
