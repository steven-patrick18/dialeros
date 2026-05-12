import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../src/lead';

// Iter 110 — phone normalisation is the same canonical-key function
// the DNC list, lead dedupe, and inbound whitelist (iter 107) all
// match on. Drift here silently breaks compliance.

describe('normalizePhone', () => {
  it('strips spaces, dashes, parens — keeps leading + and digits', () => {
    expect(normalizePhone('+1 (202) 555-0123')).toBe('+12025550123');
    expect(normalizePhone('202-555-0124')).toBe('2025550124');
    expect(normalizePhone('(202) 555 0125')).toBe('2025550125');
    expect(normalizePhone('+1.202.555.0126')).toBe(null);
  });

  it('rejects too-short or too-long', () => {
    expect(normalizePhone('123')).toBe(null);
    expect(normalizePhone('1'.repeat(25))).toBe(null);
  });

  it('rejects empty / whitespace', () => {
    expect(normalizePhone('')).toBe(null);
    expect(normalizePhone('   ')).toBe(null);
  });

  it('rejects garbage characters', () => {
    expect(normalizePhone('abc')).toBe(null);
    expect(normalizePhone('555-CALL')).toBe(null);
  });

  it('idempotent — passing a canonical value returns the same shape', () => {
    const first = normalizePhone('+1 (202) 555-0123');
    expect(first).toBe('+12025550123');
    expect(normalizePhone(first!)).toBe(first);
  });
});
