import type { Score } from './types';

/**
 * Classic 3 / 1 / 0 scoring with a +1 bonus on knockouts for picking the
 * right advancer (in case the score was a draw and went to ET / pens).
 *
 *   exact score   →  3 pts
 *   right outcome →  1 pt   (W / D / L matches actual)
 *   wrong outcome →  0
 *   knockouts: +1 if predicted advancer matches actual advancer
 */
export function scorePrediction(
  pred: Score | null | undefined,
  actual: Score | null | undefined,
  isKO: boolean,
  predAdvancer?: string | null,
  actualAdvancer?: string | null,
): number {
  if (!pred || !actual) return 0;
  let pts = 0;
  if (pred.team1 === actual.team1 && pred.team2 === actual.team2) {
    pts += 3;
  } else if (Math.sign(pred.team1 - pred.team2) === Math.sign(actual.team1 - actual.team2)) {
    pts += 1;
  }
  if (isKO && predAdvancer && actualAdvancer && predAdvancer === actualAdvancer) {
    pts += 1;
  }
  return pts;
}
