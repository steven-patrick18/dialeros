import { describe, expect, it } from 'vitest';
import { hourInTimezone, inferLeadTimezone } from '../src/timezones';

// Iter 110 — TZ inference drives iter 91 TZ_* list ordering + per-
// lead TZ window enforcement at pacer originate time. The NPA table
// is curated, not exhaustive — Eastern is the fallback. We don't
// over-fit the NPA table (it grows over time); we test the mode
// boundaries.

describe('inferLeadTimezone', () => {
  it('NANP 10-digit Eastern NPA → America/New_York', () => {
    expect(inferLeadTimezone('2025550123')).toBe('America/New_York');
  });

  it('NANP 11-digit with leading 1', () => {
    expect(inferLeadTimezone('12025550123')).toBe('America/New_York');
    expect(inferLeadTimezone('+12025550123')).toBe('America/New_York');
  });

  it('formats with spaces / dashes work', () => {
    expect(inferLeadTimezone('(202) 555-0123')).toBe('America/New_York');
  });

  it('null / empty → null', () => {
    expect(inferLeadTimezone(null)).toBe(null);
    expect(inferLeadTimezone(undefined)).toBe(null);
    expect(inferLeadTimezone('')).toBe(null);
  });

  it('unknown NPA falls back to Eastern', () => {
    // 999 isn't allocated as an NPA; should fall through to Eastern.
    expect(inferLeadTimezone('9995550123')).toBe('America/New_York');
  });
});

describe('hourInTimezone', () => {
  it('returns 0-23 for a valid IANA TZ', () => {
    const h = hourInTimezone('America/New_York');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(24);
  });

  it('falls back to local hour on invalid TZ instead of throwing', () => {
    const h = hourInTimezone('Not/A_Real_Zone');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(24);
  });

  it('reflects different TZ for fixed instant', () => {
    // 2026-05-12T14:00:00Z = 10am EDT = 7am PDT.
    const utc = new Date('2026-05-12T14:00:00Z');
    expect(hourInTimezone('America/New_York', utc)).toBe(10);
    expect(hourInTimezone('America/Los_Angeles', utc)).toBe(7);
  });
});
