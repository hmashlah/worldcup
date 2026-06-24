// Pure computation functions for tournament statistics.
// Extracted from components for testability.

import type { PredictionRow } from '@/hooks/usePredictions';

export interface PlayerStat {
  name: string;
  team: string;
  goals: number;
  penalties: number;
  own_goals: number;
  yellow_cards: number;
  red_cards: number;
  motm: number;
  appearances: number;
  position: string | null;
  dob: string | null;
  club: string | null;
  shirt_number: number | null;
}

export interface TeamStat {
  team: string;
  goals_for: number;
  goals_against: number;
  penalties: number;
  yellow_cards: number;
  red_cards: number;
  coach: string | null;
}

export interface Consensus {
  t1Pct: number;
  drawPct: number;
  t2Pct: number;
  avgT1: string;
  avgT2: string;
  total: number;
}

/** Compute consensus distribution from a list of predictions for a single match. */
export function computeConsensus(picks: Array<{ team1_score: number; team2_score: number }>): Consensus | null {
  if (picks.length < 2) return null;
  let t1Wins = 0, draws = 0, t2Wins = 0, sumT1 = 0, sumT2 = 0;
  for (const p of picks) {
    sumT1 += p.team1_score;
    sumT2 += p.team2_score;
    if (p.team1_score > p.team2_score) t1Wins++;
    else if (p.team1_score < p.team2_score) t2Wins++;
    else draws++;
  }
  const total = picks.length;
  return {
    t1Pct: Math.round((t1Wins / total) * 100),
    drawPct: Math.round((draws / total) * 100),
    t2Pct: Math.round((t2Wins / total) * 100),
    avgT1: (sumT1 / total).toFixed(1),
    avgT2: (sumT2 / total).toFixed(1),
    total,
  };
}

/** Sort players by booking severity (reds count double). */
export function rankByCards(players: PlayerStat[], limit = 5): PlayerStat[] {
  return [...players]
    .filter(p => p.yellow_cards > 0 || p.red_cards > 0)
    .sort((a, b) => (b.yellow_cards + b.red_cards * 2) - (a.yellow_cards + a.red_cards * 2))
    .slice(0, limit);
}

/** Sort players by MOTM awards. */
export function rankByMotm(players: PlayerStat[], limit = 5): PlayerStat[] {
  return [...players]
    .filter(p => p.motm > 0)
    .sort((a, b) => b.motm - a.motm)
    .slice(0, limit);
}

/** Sort teams by goals scored (best attack). */
export function rankByAttack(teams: TeamStat[], limit = 5): TeamStat[] {
  return [...teams].sort((a, b) => b.goals_for - a.goals_for).slice(0, limit);
}

/** Sort teams by goals conceded (best defence = fewest conceded). */
export function rankByDefence(teams: TeamStat[], limit = 5): TeamStat[] {
  return [...teams].sort((a, b) => a.goals_against - b.goals_against).slice(0, limit);
}

/** Sort teams by bookings (most booked). */
export function rankTeamsByCards(teams: TeamStat[], limit = 5): TeamStat[] {
  return [...teams]
    .sort((a, b) => (b.yellow_cards + b.red_cards * 2) - (a.yellow_cards + a.red_cards * 2))
    .slice(0, limit);
}

/** Compute current streak per user from most recent finished matches.
 *  Returns positive for scoring streak, negative for dry streak. */
export function computeStreak(
  matchIds: string[],
  userPreds: Record<string, PredictionRow>,
  results: Record<string, { team1_score: number; team2_score: number }>,
  scoreFn: (pred: PredictionRow, result: { team1_score: number; team2_score: number }, matchId: string) => number,
): number {
  let streak = 0;
  for (let i = matchIds.length - 1; i >= 0; i--) {
    const mid = matchIds[i];
    const pred = userPreds[mid];
    const result = results[mid];
    if (!pred || !result) break;
    const pts = scoreFn(pred, result, mid);
    if (streak === 0) {
      streak = pts > 0 ? 1 : -1;
    } else if (streak > 0 && pts > 0) {
      streak++;
    } else if (streak < 0 && pts === 0) {
      streak--;
    } else {
      break;
    }
  }
  return streak;
}
