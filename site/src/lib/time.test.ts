import { describe, it, expect } from 'vitest';
import { parseKickoff, isLocked } from './time';

describe('parseKickoff', () => {
  it('parses UTC-6 offset correctly', () => {
    const d = parseKickoff('2026-06-11', '13:00 UTC-6');
    // 13:00 UTC-6 = 19:00 UTC
    expect(d.toISOString()).toBe('2026-06-11T19:00:00.000Z');
  });

  it('parses UTC+3 offset correctly', () => {
    const d = parseKickoff('2026-07-01', '20:00 UTC+3');
    // 20:00 UTC+3 = 17:00 UTC
    expect(d.toISOString()).toBe('2026-07-01T17:00:00.000Z');
  });

  it('parses UTC-4 offset correctly', () => {
    const d = parseKickoff('2026-06-15', '19:00 UTC-4');
    // 19:00 UTC-4 = 23:00 UTC
    expect(d.toISOString()).toBe('2026-06-15T23:00:00.000Z');
  });

  it('parses UTC-7 offset correctly', () => {
    const d = parseKickoff('2026-06-13', '12:00 UTC-7');
    // 12:00 UTC-7 = 19:00 UTC
    expect(d.toISOString()).toBe('2026-06-13T19:00:00.000Z');
  });

  it('parses double-digit UTC-10 offset', () => {
    const d = parseKickoff('2026-06-20', '10:00 UTC-10');
    // 10:00 UTC-10 = 20:00 UTC
    expect(d.toISOString()).toBe('2026-06-20T20:00:00.000Z');
  });

  it('parses UTC+10 offset', () => {
    const d = parseKickoff('2026-06-20', '18:00 UTC+10');
    // 18:00 UTC+10 = 08:00 UTC
    expect(d.toISOString()).toBe('2026-06-20T08:00:00.000Z');
  });

  it('fallback: handles plain time as UTC', () => {
    const d = parseKickoff('2026-06-11', '19:00');
    expect(d.toISOString()).toBe('2026-06-11T19:00:00.000Z');
  });
});

describe('isLocked', () => {
  it('returns false before kickoff', () => {
    // Kickoff: 13:00 UTC-6 = 19:00 UTC = 1749668400000
    const beforeKickoff = new Date('2026-06-11T18:59:00Z').getTime();
    expect(isLocked('2026-06-11', '13:00 UTC-6', beforeKickoff)).toBe(false);
  });

  it('returns true at kickoff', () => {
    const atKickoff = new Date('2026-06-11T19:00:00Z').getTime();
    expect(isLocked('2026-06-11', '13:00 UTC-6', atKickoff)).toBe(true);
  });

  it('returns true after kickoff', () => {
    const afterKickoff = new Date('2026-06-11T20:30:00Z').getTime();
    expect(isLocked('2026-06-11', '13:00 UTC-6', afterKickoff)).toBe(true);
  });
});
