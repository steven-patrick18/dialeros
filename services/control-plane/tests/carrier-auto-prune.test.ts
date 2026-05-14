import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_PRUNE,
  evaluateCarrierForPruning,
  normalizeAutoPruneConfig,
} from '../src/carrier-auto-prune';

const enabled = { ...DEFAULT_AUTO_PRUNE, enabled: true };

describe('evaluateCarrierForPruning — gate conditions', () => {
  it('keep when config disabled regardless of metrics', () => {
    const d = evaluateCarrierForPruning(
      { carrier_id: 'a', races_in: 100, races_won: 0, avg_pdd_ms: 10000 },
      DEFAULT_AUTO_PRUNE,
    );
    expect(d.action).toBe('keep');
  });

  it('keep with no_data on zero races', () => {
    const d = evaluateCarrierForPruning(
      { carrier_id: 'a', races_in: 0, races_won: 0, avg_pdd_ms: null },
      enabled,
    );
    expect(d).toEqual({ action: 'keep', reason: 'no_data' });
  });

  it('keep below_min_sample even if win rate is 0', () => {
    const d = evaluateCarrierForPruning(
      { carrier_id: 'a', races_in: 5, races_won: 0, avg_pdd_ms: null },
      enabled,
    );
    expect(d).toEqual({ action: 'keep', reason: 'below_min_sample' });
  });
});

describe('evaluateCarrierForPruning — win-rate trigger', () => {
  it('pause on win_rate when below floor with enough samples', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const d = evaluateCarrierForPruning(
      // 1/100 = 1% win — below 10% floor
      { carrier_id: 'a', races_in: 100, races_won: 1, avg_pdd_ms: 1200 },
      enabled,
      now,
    );
    expect(d.action).toBe('pause');
    if (d.action === 'pause') {
      expect(d.reason).toBe('win_rate');
      expect(new Date(d.until).getTime()).toBe(
        now.getTime() + 30 * 60_000,
      );
    }
  });

  it('keep at exactly the floor (not strictly below)', () => {
    // 10/100 = 10% exactly — strict <, so this is healthy
    const d = evaluateCarrierForPruning(
      { carrier_id: 'a', races_in: 100, races_won: 10, avg_pdd_ms: 1500 },
      enabled,
    );
    expect(d.action).toBe('keep');
  });
});

describe('evaluateCarrierForPruning — PDD ceiling trigger', () => {
  it('pause when avg_pdd_ms > ceiling and enough won-samples', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const d = evaluateCarrierForPruning(
      // 30/100 = healthy win rate, but PDD 5000ms > 4000ms ceiling
      { carrier_id: 'a', races_in: 100, races_won: 30, avg_pdd_ms: 5000 },
      enabled,
      now,
    );
    expect(d.action).toBe('pause');
    if (d.action === 'pause') {
      expect(d.reason).toBe('pdd_ceiling');
    }
  });

  it('keep when PDD high but not enough won-samples', () => {
    const d = evaluateCarrierForPruning(
      // races_won (10) < min_sample (20)
      { carrier_id: 'a', races_in: 100, races_won: 10, avg_pdd_ms: 8000 },
      { ...enabled, min_sample: 20 },
    );
    expect(d.action).toBe('keep');
  });

  it('keep when PDD ms is null', () => {
    const d = evaluateCarrierForPruning(
      { carrier_id: 'a', races_in: 100, races_won: 50, avg_pdd_ms: null },
      enabled,
    );
    expect(d.action).toBe('keep');
  });

  it('keep at exactly the ceiling (not strictly above)', () => {
    const d = evaluateCarrierForPruning(
      { carrier_id: 'a', races_in: 100, races_won: 50, avg_pdd_ms: 4000 },
      enabled,
    );
    expect(d.action).toBe('keep');
  });
});

describe('evaluateCarrierForPruning — pause-until math', () => {
  it('honours cooldown_minutes', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const d = evaluateCarrierForPruning(
      { carrier_id: 'a', races_in: 100, races_won: 0, avg_pdd_ms: null },
      { ...enabled, cooldown_minutes: 90 },
      now,
    );
    if (d.action === 'pause') {
      expect(new Date(d.until).getTime() - now.getTime()).toBe(
        90 * 60_000,
      );
    }
  });
});

describe('normalizeAutoPruneConfig', () => {
  it('returns defaults for empty / non-object input', () => {
    expect(normalizeAutoPruneConfig(null)).toEqual(DEFAULT_AUTO_PRUNE);
    expect(normalizeAutoPruneConfig(undefined)).toEqual(DEFAULT_AUTO_PRUNE);
    expect(normalizeAutoPruneConfig('abc')).toEqual(DEFAULT_AUTO_PRUNE);
    expect(normalizeAutoPruneConfig(42)).toEqual(DEFAULT_AUTO_PRUNE);
    expect(normalizeAutoPruneConfig({})).toEqual(DEFAULT_AUTO_PRUNE);
  });

  it('coerces partial valid values, keeps defaults for missing', () => {
    const cfg = normalizeAutoPruneConfig({
      enabled: true,
      min_sample: 50,
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.min_sample).toBe(50);
    expect(cfg.win_rate_floor).toBe(DEFAULT_AUTO_PRUNE.win_rate_floor);
  });

  it('rejects out-of-range numbers', () => {
    const cfg = normalizeAutoPruneConfig({
      min_sample: 0,            // below min 1
      win_rate_floor: 2.5,      // above max 1
      pdd_ceiling_ms: 50,       // below min 100
      cooldown_minutes: 99999,  // above max 1440
    });
    // All revert to defaults.
    expect(cfg.min_sample).toBe(DEFAULT_AUTO_PRUNE.min_sample);
    expect(cfg.win_rate_floor).toBe(DEFAULT_AUTO_PRUNE.win_rate_floor);
    expect(cfg.pdd_ceiling_ms).toBe(DEFAULT_AUTO_PRUNE.pdd_ceiling_ms);
    expect(cfg.cooldown_minutes).toBe(DEFAULT_AUTO_PRUNE.cooldown_minutes);
  });

  it('rejects wrong types', () => {
    const cfg = normalizeAutoPruneConfig({
      enabled: 'yes',
      min_sample: '50',
      win_rate_floor: 'high',
    });
    expect(cfg).toEqual(DEFAULT_AUTO_PRUNE);
  });

  it('accepts boundary values', () => {
    const cfg = normalizeAutoPruneConfig({
      win_rate_floor: 0,
      pdd_ceiling_ms: 100,
      cooldown_minutes: 1,
    });
    expect(cfg.win_rate_floor).toBe(0);
    expect(cfg.pdd_ceiling_ms).toBe(100);
    expect(cfg.cooldown_minutes).toBe(1);
  });
});
