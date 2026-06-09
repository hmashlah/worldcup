/**
 * Parse the kickoff time-of-day for a match into an absolute Date.
 *
 * Source data shape: date = "2026-06-11", time = "13:00 UTC-6".
 * The offset is local to the host stadium (Mexican / Pacific / Eastern /
 * Central / Mountain time depending on city) — we just pass it through to
 * the Date constructor as an ISO 8601 offset.
 */
export function parseKickoff(date: string, time: string): Date {
  // "13:00 UTC-6" → "13:00", "-06:00"
  const m = /^(\d{2}):(\d{2})\s+UTC([+-]\d+)$/.exec(time.trim());
  if (!m) {
    // Fallback: assume UTC if the format doesn't match.
    return new Date(`${date}T${time}Z`);
  }
  const hh = m[1];
  const mm = m[2];
  const offsetSign = m[3].startsWith('-') ? '-' : '+';
  const offsetHours = m[3].replace(/^[+-]/, '').padStart(2, '0');
  return new Date(`${date}T${hh}:${mm}:00${offsetSign}${offsetHours}:00`);
}

export function isLocked(date: string, time: string, now: number = Date.now()): boolean {
  return now >= parseKickoff(date, time).getTime();
}

/** "Jun 11" style short date for UI labels. */
export function fmtShortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
