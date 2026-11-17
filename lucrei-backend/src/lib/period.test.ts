import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rangeStart, startOfCurrentMonth } from './period';

describe('rangeStart', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 31, 15, 30, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the epoch for "all"', () => {
    expect(rangeStart('all')).toEqual(new Date(0));
  });

  it('returns midnight of the current day in Brasília time for "today"', () => {
    vi.setSystemTime(new Date('2026-08-31T15:30:00Z'));
    expect(rangeStart('today')).toEqual(new Date('2026-08-31T03:00:00Z'));
  });

  it('keeps "today" on the Brazilian day after 21h BRT (already next day in UTC)', () => {
    vi.setSystemTime(new Date('2026-09-01T01:30:00Z')); // 31/08 22:30 BRT
    expect(rangeStart('today')).toEqual(new Date('2026-08-31T03:00:00Z'));
  });

  it('startOfCurrentMonth uses the Brazilian month', () => {
    vi.setSystemTime(new Date('2026-09-01T02:00:00Z')); // 31/08 23:00 BRT
    expect(startOfCurrentMonth()).toEqual(new Date('2026-08-01T03:00:00Z'));
    vi.setSystemTime(new Date('2026-09-01T03:00:00Z')); // 01/09 00:00 BRT
    expect(startOfCurrentMonth()).toEqual(new Date('2026-09-01T03:00:00Z'));
  });

  it('returns 7 days before now for "7d"', () => {
    const expected = new Date(new Date(2026, 7, 31, 15, 30, 0).getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(rangeStart('7d')).toEqual(expected);
  });

  it('returns 30 days before now for "30d"', () => {
    const expected = new Date(new Date(2026, 7, 31, 15, 30, 0).getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(rangeStart('30d')).toEqual(expected);
  });
});
