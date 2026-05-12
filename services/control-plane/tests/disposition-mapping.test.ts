import { describe, expect, it } from 'vitest';
import { DispositionSchema } from '../src/disposition';

// Iter 110 — pin the disposition contract. These dispositions are
// referenced by the agent feed, wrap-up modal, lead-status mapping,
// per-campaign + floor-wide dispo mix cards (iter 99 + 103), and
// iter 107's inbound whitelist. A typo in any of those surfaces
// silently breaks reporting; this test catches it.

describe('DispositionSchema', () => {
  it('accepts every documented disposition code', () => {
    const codes = [
      'SALE',
      'CALLBACK',
      'NO_INTEREST',
      'WRONG_NUMBER',
      'BAD_NUMBER',
      'ANSWERING_MACHINE',
      'DNC',
      'VOICEMAIL_DROPPED',
      'SURVEYED',
    ];
    for (const c of codes) {
      const r = DispositionSchema.safeParse(c);
      expect(r.success, `expected ${c} to parse`).toBe(true);
    }
  });

  it('rejects unknown codes', () => {
    for (const c of ['', 'sale', 'SALES', 'CALL_BACK', 'TBD']) {
      const r = DispositionSchema.safeParse(c);
      expect(r.success, `expected ${c} to fail`).toBe(false);
    }
  });
});
