// Shared pure utility functions extracted from components/hooks.
// All are unit-testable with no React or Supabase dependencies.

import type { TournamentData } from './types';
import { isKnockoutRound } from './tournament';

// ── Time formatting ─────────────────────────────────────────────────

/** Convert an ISO date string to a human-readable relative time label. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Nation name normalization ────────────────────────────────────────

const NATION_ALIASES: Record<string, string> = {
  'czechia': 'czech republic',
  'bosnia-herzegovina': 'bosnia & herzegovina',
  'cape verde islands': 'cape verde',
  'congo dr': 'dr congo',
  'united states': 'usa',
  'korea republic': 'south korea',
  'ir iran': 'iran',
  'chinese taipei': 'taiwan',
};

/** Normalize a country name to a canonical lowercase string, resolving
 *  known alias differences between data sources (FD vs our data.json). */
export function normalizeNation(name: string): string {
  const lower = name.trim().toLowerCase();
  return NATION_ALIASES[lower] ?? lower;
}

// ── Match classification ────────────────────────────────────────────

/** Check whether a match ID belongs to a knockout round. */
export function isMatchKO(data: TournamentData, matchId: string): boolean {
  const m = data.ko_matches.find(k => k.id === matchId);
  return !!m && isKnockoutRound(m.round);
}

// ── Match outcome ───────────────────────────────────────────────────

export type Outcome = 't1' | 'draw' | 't2';

/** Determine the match outcome from two scores. */
export function getOutcome(team1Score: number, team2Score: number): Outcome {
  if (team1Score > team2Score) return 't1';
  if (team1Score < team2Score) return 't2';
  return 'draw';
}

// ── Mention extraction ──────────────────────────────────────────────

/** Extract @mentioned user IDs from text by matching against known names.
 *  `profiles` is a map of user_id → { display_name }. */
export function extractMentions(
  text: string,
  profiles: Record<string, { display_name: string }>,
  selfId?: string,
): string[] {
  const mentioned: string[] = [];
  const entries = Object.entries(profiles)
    .filter(([uid]) => uid !== selfId)
    .sort((a, b) => b[1].display_name.length - a[1].display_name.length);
  const lowerText = text.toLowerCase();
  for (const [uid, p] of entries) {
    const pattern = `@${p.display_name.toLowerCase()}`;
    if (lowerText.includes(pattern)) {
      mentioned.push(uid);
    }
  }
  return [...new Set(mentioned)];
}

// ── Leaderboard ranking ─────────────────────────────────────────────

/** Two leaderboard entries share the same rank when all scoring columns match. */
export function sameRank(
  a: { total: number; exact: number; outcome: number; advancer: number },
  b: { total: number; exact: number; outcome: number; advancer: number },
): boolean {
  return (
    a.total === b.total &&
    a.exact === b.exact &&
    a.outcome === b.outcome &&
    a.advancer === b.advancer
  );
}
