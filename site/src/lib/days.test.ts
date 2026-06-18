import { describe, it, expect } from 'vitest';
import { matchesByDay, defaultDay, relativeDayLabel, shortDayLabel, countUnsubmitted } from './days';
import type { TournamentData, GroupMatch, KoMatch } from './types';

// Minimal mock data
function makeTournamentData(groupMatches: GroupMatch[], koMatches: KoMatch[] = []): TournamentData {
  return {
    groups: [{ name: 'Group A', teams: ['Brazil', 'Germany', 'Japan', 'Mexico'] }],
    group_matches: { 'Group A': groupMatches },
    ko_matches: koMatches,
    flag_map: {},
  };
}

function makeGroupMatch(overrides: Partial<GroupMatch> & { id: string; date: string; time: string }): GroupMatch {
  return {
    team1: 'Brazil',
    team2: 'Germany',
    ground: 'Stadium',
    matchday: 'Matchday 1',
    ...overrides,
  };
}

describe('matchesByDay', () => {
  it('groups matches by date', () => {
    const data = makeTournamentData([
      makeGroupMatch({ id: 'G-A-1', date: '2026-06-11', time: '13:00 UTC-6' }),
      makeGroupMatch({ id: 'G-A-2', date: '2026-06-11', time: '16:00 UTC-6' }),
      makeGroupMatch({ id: 'G-A-3', date: '2026-06-12', time: '13:00 UTC-6' }),
    ]);

    const days = matchesByDay(data);
    expect(days).toHaveLength(2);
    expect(days[0].date).toBe('2026-06-11');
    expect(days[0].matches).toHaveLength(2);
    expect(days[1].date).toBe('2026-06-12');
    expect(days[1].matches).toHaveLength(1);
  });

  it('sorts days chronologically', () => {
    const data = makeTournamentData([
      makeGroupMatch({ id: 'G-A-1', date: '2026-06-15', time: '13:00 UTC-6' }),
      makeGroupMatch({ id: 'G-A-2', date: '2026-06-11', time: '13:00 UTC-6' }),
    ]);

    const days = matchesByDay(data);
    expect(days[0].date).toBe('2026-06-11');
    expect(days[1].date).toBe('2026-06-15');
  });

  it('sorts matches within a day by kickoff time', () => {
    const data = makeTournamentData([
      makeGroupMatch({ id: 'G-A-2', date: '2026-06-11', time: '19:00 UTC-6' }),
      makeGroupMatch({ id: 'G-A-1', date: '2026-06-11', time: '13:00 UTC-6' }),
    ]);

    const days = matchesByDay(data);
    expect(days[0].matches[0].id).toBe('G-A-1');
    expect(days[0].matches[1].id).toBe('G-A-2');
  });

  it('returns empty array for empty data', () => {
    const data = makeTournamentData([]);
    expect(matchesByDay(data)).toEqual([]);
  });
});

describe('defaultDay', () => {
  it('picks the first day with matches not yet ended', () => {
    const days = [
      { date: '2026-06-11', matches: [{ id: 'G-A-1', kickoff: new Date('2026-06-11T19:00:00Z').getTime() } as any] },
      { date: '2026-06-12', matches: [{ id: 'G-A-2', kickoff: new Date('2026-06-12T19:00:00Z').getTime() } as any] },
    ];

    // Now is after first day's match ended (~2.5h after kickoff) but before second day
    const now = new Date('2026-06-12T00:00:00Z');
    expect(defaultDay(days, now)).toBe('2026-06-12');
  });

  it('returns last day when tournament is over', () => {
    const days = [
      { date: '2026-06-11', matches: [{ id: 'G-A-1', kickoff: new Date('2026-06-11T19:00:00Z').getTime() } as any] },
    ];

    const now = new Date('2026-08-01T00:00:00Z');
    expect(defaultDay(days, now)).toBe('2026-06-11');
  });

  it('returns null for empty days array', () => {
    expect(defaultDay([])).toBe(null);
  });
});

describe('relativeDayLabel', () => {
  const now = new Date('2026-06-15T12:00:00');

  it('returns "Today" for current date', () => {
    expect(relativeDayLabel('2026-06-15', now)).toBe('Today');
  });

  it('returns "Tomorrow" for next date', () => {
    expect(relativeDayLabel('2026-06-16', now)).toBe('Tomorrow');
  });

  it('returns "Yesterday" for previous date', () => {
    expect(relativeDayLabel('2026-06-14', now)).toBe('Yesterday');
  });

  it('returns formatted date for other days', () => {
    const label = relativeDayLabel('2026-06-20', now);
    // Should not be Today/Tomorrow/Yesterday
    expect(label).not.toBe('Today');
    expect(label).not.toBe('Tomorrow');
    expect(label).not.toBe('Yesterday');
    // Should contain some date info
    expect(label.length).toBeGreaterThan(0);
  });
});

describe('countUnsubmitted', () => {
  it('counts matches with no prediction that are before cutoff', () => {
    const futureKickoff = Date.now() + 3600000; // 1 hour from now
    const matches = [
      { id: 'G-A-1', kickoff: futureKickoff } as any,
      { id: 'G-A-2', kickoff: futureKickoff } as any,
      { id: 'G-A-3', kickoff: futureKickoff } as any,
    ];
    const predictions: Record<string, unknown> = { 'G-A-1': {} };

    expect(countUnsubmitted(matches, predictions)).toBe(2);
  });

  it('does not count past matches', () => {
    const pastKickoff = Date.now() - 3600000; // 1 hour ago
    const matches = [
      { id: 'G-A-1', kickoff: pastKickoff } as any,
    ];

    expect(countUnsubmitted(matches, {})).toBe(0);
  });

  it('returns 0 when all matches have predictions', () => {
    const futureKickoff = Date.now() + 3600000;
    const matches = [
      { id: 'G-A-1', kickoff: futureKickoff } as any,
    ];
    const predictions: Record<string, unknown> = { 'G-A-1': {} };

    expect(countUnsubmitted(matches, predictions)).toBe(0);
  });
});
