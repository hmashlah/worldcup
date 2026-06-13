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

/**
 * Like localDateKey, but the "day" doesn't roll over at midnight — it
 * rolls over at 5am local. So at 00:30 on Sunday you still get
 * Saturday's date, which is the day whose matches are actually still
 * being played / freshly finished.
 *
 * Football fans mentally bucket "Saturday's matches" as the cluster
 * starting Saturday afternoon and ending in the wee hours of Sunday;
 * a strict midnight rollover hides the late kickoffs from view exactly
 * when people are watching them.
 */
function viewerDayKey(d: Date): string {
  const shifted = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  return localDateKey(shifted);
}

/** "Today", "Tomorrow", "Yesterday", or "Mon, Jun 11" */
export function relativeDayLabel(date: string, now: Date = new Date()): string {
  // Use the 5am-rollover viewer day so labels and defaultDay agree.
  const today = viewerDayKey(now);
  const tomorrow = viewerDayKey(new Date(now.getTime() + 86400000));
  const yesterday = viewerDayKey(new Date(now.getTime() - 86400000));
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
 * Pick which day to default to.
 * - If today (5am-rollover) has matches, use today.
 * - Otherwise, the next upcoming match-day (or the most recent past one
 *   if the tournament is over).
 */
export function defaultDay(days: Array<{ date: string }>, now: Date = new Date()): string | null {
  if (!days.length) return null;
  const today = viewerDayKey(now);
  if (days.some(d => d.date === today)) return today;
  const future = days.find(d => d.date > today);
  if (future) return future.date;
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
