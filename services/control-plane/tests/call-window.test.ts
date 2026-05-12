import { describe, expect, it } from 'vitest';
import { __test__ } from '../src/pacing';

// Iter 110 — call window enforcement. The pacer's call_window_start/end
// is dialer-local (per-lead TZ is layered on top elsewhere). Wraps
// midnight when start > end. Both equal = empty window = never dial.

const { isWithinCallWindow } = __test__;

function mkCampaign(start: string | null, end: string | null) {
  return { call_window_start: start, call_window_end: end } as never;
}

describe('isWithinCallWindow', () => {
  it('allows always when no window set', () => {
    expect(isWithinCallWindow(mkCampaign(null, null), new Date('2026-05-12T03:00:00'))).toBe(true);
  });

  it('inside a daytime window', () => {
    const c = mkCampaign('08:00', '21:00');
    expect(isWithinCallWindow(c, new Date(2026, 4, 12, 14, 0))).toBe(true);
  });

  it('before the window opens', () => {
    const c = mkCampaign('08:00', '21:00');
    expect(isWithinCallWindow(c, new Date(2026, 4, 12, 7, 30))).toBe(false);
  });

  it('after the window closes', () => {
    const c = mkCampaign('08:00', '21:00');
    expect(isWithinCallWindow(c, new Date(2026, 4, 12, 21, 0))).toBe(false);
  });

  it('end-inclusive is FALSE at exact end minute', () => {
    const c = mkCampaign('08:00', '21:00');
    expect(isWithinCallWindow(c, new Date(2026, 4, 12, 21, 0))).toBe(false);
  });

  it('wraps midnight — 22:00–06:00 includes 02:00', () => {
    const c = mkCampaign('22:00', '06:00');
    expect(isWithinCallWindow(c, new Date(2026, 4, 12, 2, 0))).toBe(true);
  });

  it('wraps midnight — 22:00–06:00 excludes 12:00', () => {
    const c = mkCampaign('22:00', '06:00');
    expect(isWithinCallWindow(c, new Date(2026, 4, 12, 12, 0))).toBe(false);
  });

  it('empty window (start === end) refuses all', () => {
    const c = mkCampaign('08:00', '08:00');
    expect(isWithinCallWindow(c, new Date(2026, 4, 12, 8, 0))).toBe(false);
    expect(isWithinCallWindow(c, new Date(2026, 4, 12, 14, 0))).toBe(false);
  });
});
