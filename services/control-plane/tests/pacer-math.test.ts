import { describe, expect, it } from 'vitest';
import { computeDialTarget } from '../src/pacing';

// Iter 110 — pacer ratio-dial math. The iter 108 fix changed from a
// per-tick burst (`poolSize × dial_level` every tick, no decrement)
// to a total in-flight ceiling. Re-introducing the old behavior
// would over-dial by N× ticks until calls hang up — exactly the
// "30 dialing on 5 lines × dial_level 1" bug. These tests pin the
// new semantics.

describe('computeDialTarget — ViciDial ratio-dial semantics', () => {
  it('1:1 power dial — 5 lines × dial_level 1 caps at 5 total', () => {
    expect(computeDialTarget(5, 1, 0)).toBe(5);
    expect(computeDialTarget(5, 1, 3)).toBe(2);
    expect(computeDialTarget(5, 1, 5)).toBe(0);
  });

  it('does not fire when in-flight is already at the ceiling', () => {
    expect(computeDialTarget(5, 1, 5)).toBe(0);
    expect(computeDialTarget(5, 1, 6)).toBe(0); // over-saturation (e.g. cross-campaign) clamps to 0
  });

  it('dial_level 2 caps at 2× pool', () => {
    expect(computeDialTarget(5, 2, 0)).toBe(10);
    expect(computeDialTarget(5, 2, 7)).toBe(3);
  });

  it('dial_level 3 caps at 3× pool — the iter 86 example', () => {
    expect(computeDialTarget(5, 3, 0)).toBe(15);
    expect(computeDialTarget(5, 3, 14)).toBe(1);
    expect(computeDialTarget(5, 3, 15)).toBe(0);
  });

  it('fractional dial_level floors correctly', () => {
    expect(computeDialTarget(3, 1.5, 0)).toBe(4); // floor(3 × 1.5) = 4
    expect(computeDialTarget(3, 0.5, 0)).toBe(1); // floor(1.5) = 1
  });

  it('empty pool fires 0 regardless of dial_level', () => {
    expect(computeDialTarget(0, 1, 0)).toBe(0);
    expect(computeDialTarget(0, 5, 0)).toBe(0);
  });

  it('dial_level=0 / missing defaults to 1', () => {
    expect(computeDialTarget(5, 0, 0)).toBe(5);
  });

  it('regression — over-dial bug fixed: doesn\'t accumulate per tick', () => {
    // Simulate 6 ticks at 5 lines × dial_level 1 with NO hangups in
    // between. Under the pre-iter-108 bug, target would be 5 every
    // tick → 30 in flight. Under the new math, target trends to 0
    // once the cap is hit.
    let inFlight = 0;
    for (let tick = 0; tick < 6; tick++) {
      const t = computeDialTarget(5, 1, inFlight);
      inFlight += t;
    }
    expect(inFlight).toBe(5); // not 30
  });
});
