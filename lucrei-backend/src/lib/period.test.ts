import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rangeStart } from './period';

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

  it('returns midnight of the current day for "today"', () => {
    expect(rangeStart('today')).toEqual(new Date(2026, 7, 31, 0, 0, 0, 0));
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
