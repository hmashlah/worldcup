// Per-day grouping of all matches. Used by the Today view and the day-strip.

import type { GroupMatch, KoMatch, TournamentData } from './types';
import { parseKickoff } from './time';

export interface DayMatch {
  /** Stable id (G-A-1, M73, M-Final, M-3rd) */
  id: string;
  date: string;          // YYYY-MM-DD (local-day calendar)
  time: string;
  team1: string;
  team2: string;
  ground: string;
  isKO: boolean;
  /** For knockouts only — the round name */
  round?: string;
  /** Original group name (e.g. "Group A") for group matches */
  group?: string;
  /** Sortable kickoff timestamp */
  kickoff: number;
}

/** All matches in one flat list, sorted by kickoff time. */
export function allMatches(data: TournamentData): DayMatch[] {
  const out: DayMatch[] = [];
  for (const [groupName, matches] of Object.entries(data.group_matches)) {
    for (const m of matches as GroupMatch[]) {
      out.push({
        id: m.id,
        date: m.date,
        time: m.time,
        team1: m.team1,
        team2: m.team2,
        ground: m.ground,
        isKO: false,
        group: groupName,
        kickoff: parseKickoff(m.date, m.time).getTime(),
      });
    }
  }
  for (const m of data.ko_matches as KoMatch[]) {
    out.push({
      id: m.id,
      date: m.date,
      time: m.time,
      team1: m.team1,
      team2: m.team2,
      ground: m.ground,
      isKO: true,
      round: m.round,
      kickoff: parseKickoff(m.date, m.time).getTime(),
    });
  }
  out.sort((a, b) => a.kickoff - b.kickoff);
  return out;
}

/** Group matches by their date string. Returns an ordered array of (date, matches) pairs. */
export function matchesByDay(data: TournamentData): Array<{ date: string; matches: DayMatch[] }> {
  const buckets: Record<string, DayMatch[]> = {};
  for (const m of allMatches(data)) {
    if (!buckets[m.date]) buckets[m.date] = [];
    buckets[m.date].push(m);
  }
  return Object.keys(buckets)
    .sort()
    .map(date => ({ date, matches: buckets[date] }));
}

/** YYYY-MM-DD for a Date in the user's local TZ. */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "Today", "Tomorrow", "Yesterday", or "Mon, Jun 11" */
export function relativeDayLabel(date: string, now: Date = new Date()): string {
  const today = localDateKey(now);
  const tomorrow = localDateKey(new Date(now.getTime() + 86400000));
  const yesterday = localDateKey(new Date(now.getTime() - 86400000));
  if (date === today) return 'Today';
  if (date === tomorrow) return 'Tomorrow';
  if (date === yesterday) return 'Yesterday';
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Mon · Jun 11" — short form for the day strip pills. */
export function shortDayLabel(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

/**
 * Pick which day-bucket to land on when the user opens the page.
 *
 * The schedule data uses each match's STADIUM-LOCAL date — so a match
 * that kicks off in Mexico at 22:30 local on June 12 is filed under
 * '2026-06-12' even though European viewers experience it at 03:00 on
 * June 13. A naive `today === bucket.date` check leaves European
 * viewers staring at the wrong day for hours every match-night.
 *
 * Rule that handles every timezone: pick the first bucket whose latest
 * match hasn't ended yet (kickoff + ~2.5h covers regulation + ET +
 * stoppage with a small cushion). Fall back to the next upcoming
 * bucket, or the last one if the tournament is over.
 *
 * Result: at 00:07 Berlin time, with the Mexico/US late-night cluster
 * still in progress, the page lands on that cluster's date instead of
 * skipping ahead to a bucket that hasn't started yet.
 */
const ASSUMED_MATCH_DURATION_MS = 2.5 * 60 * 60 * 1000;

export function defaultDay(
  days: Array<{ date: string; matches: DayMatch[] }>,
  now: Date = new Date(),
): string | null {
  if (!days.length) return null;
  const nowMs = now.getTime();
  // Walk in chronological order; first bucket with a still-running or
  // upcoming match wins. Within a bucket we look at the LAST match's
  // end time so a single late kickoff keeps the whole day "current".
  for (const d of days) {
    const lastEndMs = d.matches.reduce(
      (acc, m) => Math.max(acc, m.kickoff + ASSUMED_MATCH_DURATION_MS),
      0,
    );
    if (lastEndMs > nowMs) return d.date;
  }
  // Tournament is over — show the final day.
  return days[days.length - 1].date;
}

/** Count of unsubmitted picks for a day, given the user's predictions. */
export function countUnsubmitted(
  matches: DayMatch[],
  predictions: Record<string, unknown>,
  now: number = Date.now(),
): number {
  return matches.filter(m => m.kickoff > now && !predictions[m.id]).length;
}
