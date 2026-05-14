// Iter 187 — Adaptive PDD-based carrier race auto-prune.
//
// Pure decision function — given a carrier's recent race stats
// + the operator-configured thresholds, returns whether the
// carrier should be paused from racing and the new
// race_paused_until timestamp.
//
// Triggers (any one is enough):
//   1. WIN-RATE FLOOR: races_in >= min_sample AND win_rate < floor
//   2. PDD CEILING:    races_won >= min_sample AND avg_pdd_ms > ceiling
//
// The min_sample guard prevents pausing a carrier after one bad
// race. Default min_sample=20 means an operator needs to see at
// least 20 races on the carrier before auto-prune kicks in.
//
// Cooldown timer:
//   paused_until = now + cooldown_minutes (default 30).
//   When the timer expires the carrier rejoins races
//   automatically. The sweeper re-evaluates each tick — if the
//   carrier's metrics improve (or stay bad), the next pause
//   fires fresh from that data.

export interface CarrierRaceMetrics {
  carrier_id: string;
  races_in: number;
  races_won: number;
  avg_pdd_ms: number | null;
}

export interface AutoPruneConfig {
  enabled: boolean;
  min_sample: number;
  win_rate_floor: number;   // 0..1; e.g. 0.10 means <10% win rate triggers
  pdd_ceiling_ms: number;   // e.g. 4000 means avg PDD >4s triggers
  cooldown_minutes: number; // how long to pause for
}

export const DEFAULT_AUTO_PRUNE: AutoPruneConfig = {
  enabled: false,
  min_sample: 20,
  win_rate_floor: 0.10,
  pdd_ceiling_ms: 4000,
  cooldown_minutes: 30,
};

export type PruneDecision =
  | { action: 'pause'; reason: 'win_rate' | 'pdd_ceiling'; until: string }
  | { action: 'keep'; reason: 'no_data' | 'below_min_sample' | 'healthy' };

export function evaluateCarrierForPruning(
  metrics: CarrierRaceMetrics,
  config: AutoPruneConfig,
  now: Date = new Date(),
): PruneDecision {
  if (!config.enabled) return { action: 'keep', reason: 'healthy' };
  if (metrics.races_in === 0) {
    return { action: 'keep', reason: 'no_data' };
  }
  if (metrics.races_in < config.min_sample) {
    return { action: 'keep', reason: 'below_min_sample' };
  }
  const winRate = metrics.races_won / metrics.races_in;
  if (winRate < config.win_rate_floor) {
    return {
      action: 'pause',
      reason: 'win_rate',
      until: pauseUntilIso(now, config.cooldown_minutes),
    };
  }
  // PDD ceiling check requires won-races to have measured PDD —
  // a 0-win carrier already failed the win-rate test above, so
  // we know win count > 0 here when win_rate >= floor.
  if (
    metrics.races_won >= config.min_sample &&
    metrics.avg_pdd_ms != null &&
    metrics.avg_pdd_ms > config.pdd_ceiling_ms
  ) {
    return {
      action: 'pause',
      reason: 'pdd_ceiling',
      until: pauseUntilIso(now, config.cooldown_minutes),
    };
  }
  return { action: 'keep', reason: 'healthy' };
}

function pauseUntilIso(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/** Validate + coerce a partial config from JSON into a full
 * AutoPruneConfig. Out-of-range values revert to defaults. */
export function normalizeAutoPruneConfig(
  raw: unknown,
): AutoPruneConfig {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const get = <T>(k: string, fallback: T, validator: (v: unknown) => v is T): T =>
    validator(obj[k]) ? (obj[k] as T) : fallback;
  const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
  const isPosInt = (lo: number, hi: number) => (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  const isFrac = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  return {
    enabled: get('enabled', DEFAULT_AUTO_PRUNE.enabled, isBool),
    min_sample: get('min_sample', DEFAULT_AUTO_PRUNE.min_sample, isPosInt(1, 10_000)),
    win_rate_floor: get(
      'win_rate_floor',
      DEFAULT_AUTO_PRUNE.win_rate_floor,
      isFrac,
    ),
    pdd_ceiling_ms: get(
      'pdd_ceiling_ms',
      DEFAULT_AUTO_PRUNE.pdd_ceiling_ms,
      isPosInt(100, 60_000),
    ),
    cooldown_minutes: get(
      'cooldown_minutes',
      DEFAULT_AUTO_PRUNE.cooldown_minutes,
      isPosInt(1, 24 * 60),
    ),
  };
}
