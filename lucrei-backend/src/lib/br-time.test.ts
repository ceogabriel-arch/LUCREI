import { describe, expect, it } from 'vitest';

import { brDayKey, brMidnight, formatBrDate, startOfBrDay, startOfBrMonth, toBrWallClockDate } from './br-time';

describe('br-time', () => {
  it('20:59 BRT (23:59 UTC) is still the same day', () => {
    const d = new Date('2026-03-10T23:59:00Z');
    expect(brDayKey(d)).toBe('2026-03-10');
    expect(startOfBrDay(d)).toEqual(new Date('2026-03-10T03:00:00Z'));
  });

  it('21:00 BRT (00:00 UTC next day) still belongs to the Brazilian day', () => {
    const d = new Date('2026-03-11T00:00:00Z');
    expect(brDayKey(d)).toBe('2026-03-10');
    expect(startOfBrDay(d)).toEqual(new Date('2026-03-10T03:00:00Z'));
  });

  it('flips the day exactly at 00:00 BRT (03:00 UTC)', () => {
    expect(brDayKey(new Date('2026-03-11T02:59:59Z'))).toBe('2026-03-10');
    expect(brDayKey(new Date('2026-03-11T03:00:00Z'))).toBe('2026-03-11');
  });

  it('month rollover: 31/01 23:30 BRT is still January', () => {
    const d = new Date('2026-02-01T02:30:00Z');
    expect(brDayKey(d)).toBe('2026-01-31');
    expect(startOfBrMonth(d)).toEqual(new Date('2026-01-01T03:00:00Z'));
    expect(startOfBrMonth(new Date('2026-02-01T03:00:00Z'))).toEqual(new Date('2026-02-01T03:00:00Z'));
  });

  it('year rollover', () => {
    const d = new Date('2027-01-01T01:00:00Z'); // 31/12/2026 22:00 BRT
    expect(brDayKey(d)).toBe('2026-12-31');
    expect(startOfBrMonth(d)).toEqual(new Date('2026-12-01T03:00:00Z'));
  });

  it('brMidnight handles overflowing month', () => {
    expect(brMidnight(2026, 13, 1)).toEqual(new Date('2027-01-01T03:00:00Z'));
  });

  it('formats dd/mm/aaaa in Brasília time', () => {
    expect(formatBrDate(new Date('2026-03-11T01:00:00Z'))).toBe('10/03/2026');
  });

  it('wall-clock date keeps Brazilian components as UTC', () => {
    expect(toBrWallClockDate(new Date('2026-03-11T01:00:00Z'))).toEqual(new Date('2026-03-10T22:00:00Z'));
  });
});
