import { describe, it, expect } from 'vitest';
import {
  relativeTime,
  normalizeNation,
  isMatchKO,
  getOutcome,
  extractMentions,
  sameRank,
} from './utils';
import type { TournamentData } from './types';

// ── relativeTime ────────────────────────────────────────────────────

describe('relativeTime', () => {
  const base = new Date('2026-06-23T12:00:00Z').getTime();

  it('returns "just now" for < 60s ago', () => {
    const iso = new Date(base - 30_000).toISOString();
    expect(relativeTime(iso, base)).toBe('just now');
  });

  it('returns minutes for < 60 min ago', () => {
    const iso = new Date(base - 5 * 60_000).toISOString();
    expect(relativeTime(iso, base)).toBe('5m ago');
  });

  it('returns hours for < 24h ago', () => {
    const iso = new Date(base - 3 * 3_600_000).toISOString();
    expect(relativeTime(iso, base)).toBe('3h ago');
  });

  it('returns days for >= 24h ago', () => {
    const iso = new Date(base - 2 * 86_400_000).toISOString();
    expect(relativeTime(iso, base)).toBe('2d ago');
  });

  it('handles exactly 1 minute', () => {
    const iso = new Date(base - 60_000).toISOString();
    expect(relativeTime(iso, base)).toBe('1m ago');
  });

  it('handles exactly 1 hour', () => {
    const iso = new Date(base - 3_600_000).toISOString();
    expect(relativeTime(iso, base)).toBe('1h ago');
  });

  it('handles exactly 1 day', () => {
    const iso = new Date(base - 86_400_000).toISOString();
    expect(relativeTime(iso, base)).toBe('1d ago');
  });
});

// ── normalizeNation ─────────────────────────────────────────────────

describe('normalizeNation', () => {
  it('lowercases normal names', () => {
    expect(normalizeNation('Germany')).toBe('germany');
  });

  it('resolves known aliases', () => {
    expect(normalizeNation('Czechia')).toBe('czech republic');
    expect(normalizeNation('United States')).toBe('usa');
    expect(normalizeNation('Congo DR')).toBe('dr congo');
    expect(normalizeNation('Korea Republic')).toBe('south korea');
  });

  it('trims whitespace', () => {
    expect(normalizeNation('  Brazil  ')).toBe('brazil');
  });

  it('returns as-is for unknown names', () => {
    expect(normalizeNation('Argentina')).toBe('argentina');
  });
});

// ── isMatchKO ───────────────────────────────────────────────────────

describe('isMatchKO', () => {
  const data: TournamentData = {
    groups: [],
    group_matches: {},
    ko_matches: [
      { id: 'KO-1', num: 73, round: 'Round of 16', date: '', time: '', team1: 'A', team2: 'B', ground: '' },
      { id: 'KO-2', num: 74, round: 'Quarter-final', date: '', time: '', team1: 'C', team2: 'D', ground: '' },
    ],
    flag_map: {},
  };

  it('returns true for knockout matches', () => {
    expect(isMatchKO(data, 'KO-1')).toBe(true);
    expect(isMatchKO(data, 'KO-2')).toBe(true);
  });

  it('returns false for unknown match IDs', () => {
    expect(isMatchKO(data, 'NONEXISTENT')).toBe(false);
  });
});

// ── getOutcome ──────────────────────────────────────────────────────

describe('getOutcome', () => {
  it('returns t1 when team1 wins', () => {
    expect(getOutcome(3, 1)).toBe('t1');
  });

  it('returns t2 when team2 wins', () => {
    expect(getOutcome(0, 2)).toBe('t2');
  });

  it('returns draw when scores are equal', () => {
    expect(getOutcome(1, 1)).toBe('draw');
    expect(getOutcome(0, 0)).toBe('draw');
  });
});

// ── extractMentions ─────────────────────────────────────────────────

describe('extractMentions', () => {
  const profiles = {
    'uid-1': { display_name: 'Margo' },
    'uid-2': { display_name: 'Hazem' },
    'uid-3': { display_name: 'Bonie' },
    'uid-4': { display_name: 'Aria Rose' },
  };

  it('extracts a single mention', () => {
    expect(extractMentions('@Margo are you ready?', profiles)).toEqual(['uid-1']);
  });

  it('extracts multiple mentions', () => {
    const result = extractMentions('@Margo @Hazem let\'s go!', profiles);
    expect(result).toContain('uid-1');
    expect(result).toContain('uid-2');
    expect(result.length).toBe(2);
  });

  it('is case-insensitive', () => {
    expect(extractMentions('@margo hello', profiles)).toEqual(['uid-1']);
    expect(extractMentions('@HAZEM yo', profiles)).toEqual(['uid-2']);
  });

  it('handles names with spaces', () => {
    expect(extractMentions('@Aria Rose nice pick', profiles)).toEqual(['uid-4']);
  });

  it('returns empty for no mentions', () => {
    expect(extractMentions('no mentions here', profiles)).toEqual([]);
  });

  it('does not match partial names without @', () => {
    expect(extractMentions('Margo is great', profiles)).toEqual([]);
  });

  it('deduplicates repeated mentions', () => {
    expect(extractMentions('@Margo @Margo', profiles)).toEqual(['uid-1']);
  });

  it('excludes self when selfId is provided', () => {
    expect(extractMentions('@Hazem test', profiles, 'uid-2')).toEqual([]);
  });

  it('still finds others when selfId is provided', () => {
    expect(extractMentions('@Margo @Hazem', profiles, 'uid-2')).toEqual(['uid-1']);
  });
});

// ── sameRank ────────────────────────────────────────────────────────

describe('sameRank', () => {
  it('returns true when all columns match', () => {
    const a = { total: 10, exact: 3, outcome: 5, advancer: 2 };
    const b = { total: 10, exact: 3, outcome: 5, advancer: 2 };
    expect(sameRank(a, b)).toBe(true);
  });

  it('returns false when any column differs', () => {
    const base = { total: 10, exact: 3, outcome: 5, advancer: 2 };
    expect(sameRank(base, { ...base, total: 9 })).toBe(false);
    expect(sameRank(base, { ...base, exact: 2 })).toBe(false);
    expect(sameRank(base, { ...base, outcome: 4 })).toBe(false);
    expect(sameRank(base, { ...base, advancer: 1 })).toBe(false);
  });
});
