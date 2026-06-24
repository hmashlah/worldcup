import { describe, it, expect } from 'vitest';
import {
  computeConsensus,
  rankByCards,
  rankByMotm,
  rankByAttack,
  rankByDefence,
  rankTeamsByCards,
  computeStreak,
  type PlayerStat,
  type TeamStat,
} from './stats';

// ── computeConsensus ────────────────────────────────────────────────

describe('computeConsensus', () => {
  it('returns null for fewer than 2 picks', () => {
    expect(computeConsensus([{ team1_score: 2, team2_score: 1 }])).toBeNull();
    expect(computeConsensus([])).toBeNull();
  });

  it('computes percentages correctly', () => {
    const picks = [
      { team1_score: 2, team2_score: 1 }, // t1 win
      { team1_score: 1, team2_score: 1 }, // draw
      { team1_score: 0, team2_score: 2 }, // t2 win
      { team1_score: 3, team2_score: 0 }, // t1 win
    ];
    const result = computeConsensus(picks)!;
    expect(result.t1Pct).toBe(50);
    expect(result.drawPct).toBe(25);
    expect(result.t2Pct).toBe(25);
    expect(result.total).toBe(4);
  });

  it('computes averages', () => {
    const picks = [
      { team1_score: 2, team2_score: 0 },
      { team1_score: 1, team2_score: 1 },
    ];
    const result = computeConsensus(picks)!;
    expect(result.avgT1).toBe('1.5');
    expect(result.avgT2).toBe('0.5');
  });

  it('handles all same outcome', () => {
    const picks = [
      { team1_score: 1, team2_score: 0 },
      { team1_score: 2, team2_score: 1 },
      { team1_score: 3, team2_score: 2 },
    ];
    const result = computeConsensus(picks)!;
    expect(result.t1Pct).toBe(100);
    expect(result.drawPct).toBe(0);
    expect(result.t2Pct).toBe(0);
  });
});

// ── rankByCards ─────────────────────────────────────────────────────

describe('rankByCards', () => {
  const players: PlayerStat[] = [
    { name: 'A', team: 'T1', goals: 0, penalties: 0, own_goals: 0, yellow_cards: 3, red_cards: 0, motm: 0, appearances: 3 },
    { name: 'B', team: 'T2', goals: 0, penalties: 0, own_goals: 0, yellow_cards: 1, red_cards: 1, motm: 0, appearances: 3 },
    { name: 'C', team: 'T3', goals: 0, penalties: 0, own_goals: 0, yellow_cards: 0, red_cards: 0, motm: 0, appearances: 3 },
    { name: 'D', team: 'T4', goals: 0, penalties: 0, own_goals: 0, yellow_cards: 2, red_cards: 0, motm: 0, appearances: 3 },
  ];

  it('ranks by yellows + reds*2, filters zero-card players', () => {
    const result = rankByCards(players);
    expect(result.length).toBe(3); // C filtered out
    expect(result[0].name).toBe('A'); // 3 + 0*2 = 3
    expect(result[1].name).toBe('B'); // 1 + 1*2 = 3 — tied but stable sort
  });

  it('respects limit', () => {
    expect(rankByCards(players, 2).length).toBe(2);
  });
});

// ── rankByMotm ──────────────────────────────────────────────────────

describe('rankByMotm', () => {
  const players: PlayerStat[] = [
    { name: 'A', team: 'T1', goals: 0, penalties: 0, own_goals: 0, yellow_cards: 0, red_cards: 0, motm: 2, appearances: 3 },
    { name: 'B', team: 'T2', goals: 0, penalties: 0, own_goals: 0, yellow_cards: 0, red_cards: 0, motm: 0, appearances: 3 },
    { name: 'C', team: 'T3', goals: 0, penalties: 0, own_goals: 0, yellow_cards: 0, red_cards: 0, motm: 1, appearances: 3 },
  ];

  it('ranks by motm count, filters zeros', () => {
    const result = rankByMotm(players);
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('A');
    expect(result[1].name).toBe('C');
  });
});

// ── rankByAttack / rankByDefence / rankTeamsByCards ──────────────────

describe('team rankings', () => {
  const teams: TeamStat[] = [
    { team: 'Brazil', goals_for: 8, goals_against: 2, penalties: 1, yellow_cards: 5, red_cards: 0 },
    { team: 'Germany', goals_for: 5, goals_against: 1, penalties: 0, yellow_cards: 3, red_cards: 1 },
    { team: 'Iran', goals_for: 2, goals_against: 6, penalties: 0, yellow_cards: 8, red_cards: 0 },
  ];

  it('rankByAttack sorts by goals_for descending', () => {
    const result = rankByAttack(teams);
    expect(result[0].team).toBe('Brazil');
    expect(result[2].team).toBe('Iran');
  });

  it('rankByDefence sorts by goals_against ascending', () => {
    const result = rankByDefence(teams);
    expect(result[0].team).toBe('Germany'); // 1 conceded
    expect(result[2].team).toBe('Iran');    // 6 conceded
  });

  it('rankTeamsByCards sorts by card severity', () => {
    const result = rankTeamsByCards(teams);
    expect(result[0].team).toBe('Iran');    // 8 + 0*2 = 8
    expect(result[1].team).toBe('Brazil');  // 5 + 0*2 = 5
    expect(result[2].team).toBe('Germany'); // 3 + 1*2 = 5 — tied
  });
});

// ── computeStreak ───────────────────────────────────────────────────

describe('computeStreak', () => {
  const scoreFn = (pred: { team1_score: number; team2_score: number }, result: { team1_score: number; team2_score: number }) => {
    if (pred.team1_score === result.team1_score && pred.team2_score === result.team2_score) return 3;
    const ps = Math.sign(pred.team1_score - pred.team2_score);
    const rs = Math.sign(result.team1_score - result.team2_score);
    return ps === rs ? 1 : 0;
  };

  it('returns positive streak when last matches all scored', () => {
    const matchIds = ['m1', 'm2', 'm3'];
    const preds = {
      m1: { user_id: 'u', match_id: 'm1', team1_score: 2, team2_score: 1, advancer: null },
      m2: { user_id: 'u', match_id: 'm2', team1_score: 1, team2_score: 0, advancer: null },
      m3: { user_id: 'u', match_id: 'm3', team1_score: 0, team2_score: 1, advancer: null },
    };
    const results = {
      m1: { team1_score: 3, team2_score: 0 }, // outcome match → 1pt
      m2: { team1_score: 2, team2_score: 1 }, // outcome match → 1pt
      m3: { team1_score: 0, team2_score: 2 }, // outcome match → 1pt
    };
    expect(computeStreak(matchIds, preds, results, scoreFn)).toBe(3);
  });

  it('returns negative streak when last matches all 0pts', () => {
    const matchIds = ['m1', 'm2', 'm3'];
    const preds = {
      m1: { user_id: 'u', match_id: 'm1', team1_score: 2, team2_score: 0, advancer: null },
      m2: { user_id: 'u', match_id: 'm2', team1_score: 2, team2_score: 0, advancer: null },
      m3: { user_id: 'u', match_id: 'm3', team1_score: 2, team2_score: 0, advancer: null },
    };
    const results = {
      m1: { team1_score: 0, team2_score: 1 }, // wrong
      m2: { team1_score: 0, team2_score: 2 }, // wrong
      m3: { team1_score: 1, team2_score: 1 }, // wrong
    };
    expect(computeStreak(matchIds, preds, results, scoreFn)).toBe(-3);
  });

  it('breaks streak on direction change', () => {
    const matchIds = ['m1', 'm2', 'm3'];
    const preds = {
      m1: { user_id: 'u', match_id: 'm1', team1_score: 1, team2_score: 0, advancer: null },
      m2: { user_id: 'u', match_id: 'm2', team1_score: 2, team2_score: 0, advancer: null },
      m3: { user_id: 'u', match_id: 'm3', team1_score: 1, team2_score: 1, advancer: null },
    };
    const results = {
      m1: { team1_score: 2, team2_score: 1 }, // 1pt (outcome)
      m2: { team1_score: 0, team2_score: 1 }, // 0pt (wrong)
      m3: { team1_score: 1, team2_score: 1 }, // 3pt (exact)
    };
    // Walking backwards: m3=3pt → m2=0pt → breaks
    expect(computeStreak(matchIds, preds, results, scoreFn)).toBe(1);
  });

  it('returns 0 when no predictions', () => {
    expect(computeStreak(['m1'], {}, { m1: { team1_score: 1, team2_score: 0 } }, scoreFn)).toBe(0);
  });
});
