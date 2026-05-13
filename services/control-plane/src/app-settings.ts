import {
  appSettingExists,
  deleteAppSetting,
  getAppSettingEncrypted,
  setAppSettingEncrypted,
} from './db';
import { decryptSecret, encryptSecret } from './secrets';

/**
 * Iter 28 — encrypted key/value settings. Used today for the SignalWire
 * token; will hold any future cross-cutting admin-managed secret that
 * doesn't deserve its own table.
 */
export function setAppSetting(key: string, plaintext: string): void {
  setAppSettingEncrypted(key, encryptSecret(plaintext));
}

export function getAppSetting(key: string): string | null {
  const enc = getAppSettingEncrypted(key);
  if (!enc) return null;
  return decryptSecret(enc);
}

export function hasAppSetting(key: string): boolean {
  return appSettingExists(key);
}

export function clearAppSetting(key: string): boolean {
  return deleteAppSetting(key);
}

// Stable keys — keep these here so the rest of the app doesn't depend
// on raw strings.
export const APP_SETTING_KEYS = {
  signalwireToken: 'signalwire.token',
  freeswitchInstallStatus: 'freeswitch.install_status',
  freeswitchInstallLog: 'freeswitch.install_log',
  // Iter 36 — domain + TLS bootstrap
  canonicalDomain: 'domain.canonical',
  tlsContactEmail: 'tls.contact_email',
  // Iter 56 — call recording retention (days). Default 30; admin can
  // override via the settings UI later. Encrypted-at-rest along with
  // every other app_setting, even though it's not secret — keeps the
  // table shape uniform.
  recordingRetentionDays: 'recording.retention_days',
  // Iter 144 — opt-in toggle for the nightly prune job. Default
  // false so existing deploys don't silently lose recordings the
  // moment iter 144 lands; admin opts in via /settings/recording-retention.
  recordingRetentionEnabled: 'recording.retention_enabled',
  // Iter 134 — predictive-pacing recommendation curve.
  // JSON-encoded PacingThresholds object. Admin-tunable
  // via /settings/pacing; defaults applied when unset.
  pacingThresholds: 'pacing.recommendation_thresholds',
  // Iter 163 — wrap-up enforcement toggle. When 'on', the
  // agent /status POST refuses to flip an agent to AVAILABLE
  // while they have an undispositioned connected call.
  wrapupEnforcementEnabled: 'wrapup.enforcement_enabled',
  // Iter 166 — Per-lead frequency cap (TCPA pre-dial guard).
  freqCapEnabled: 'freq_cap.enabled',
  freqCapLeadCount: 'freq_cap.lead_count',
  freqCapLeadWindowHours: 'freq_cap.lead_window_hours',
} as const;

export const RECORDING_RETENTION_DEFAULT_DAYS = 30;

export function getRecordingRetentionDays(): number {
  const raw = getAppSetting(APP_SETTING_KEYS.recordingRetentionDays);
  if (!raw) return RECORDING_RETENTION_DEFAULT_DAYS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    return RECORDING_RETENTION_DEFAULT_DAYS;
  }
  return n;
}

/* Iter 144 — recording retention setters + enabled flag.
 * The "enabled" toggle is independent of the days knob: an
 * admin can stage a 7-day value, then flip the switch when
 * they're ready. Clamps to [1, 3650] days at write time so a
 * misclick can't accidentally configure "delete everything
 * older than 0 days" (which would wipe the entire folder on
 * the next prune tick). */
export function setRecordingRetentionDays(days: number): void {
  const clamped = Math.max(1, Math.min(3650, Math.floor(days)));
  setAppSetting(
    APP_SETTING_KEYS.recordingRetentionDays,
    String(clamped),
  );
}

export function getRecordingRetentionEnabled(): boolean {
  return getAppSetting(APP_SETTING_KEYS.recordingRetentionEnabled) === '1';
}

export function setRecordingRetentionEnabled(enabled: boolean): void {
  setAppSetting(
    APP_SETTING_KEYS.recordingRetentionEnabled,
    enabled ? '1' : '0',
  );
}

// Iter 134 — admin-tunable predictive-pacing recommendation curve.
//
// Stored as a JSON array of {min_rate, dial_level} steps sorted by
// min_rate DESC. recommendDialLevel picks the FIRST step whose
// min_rate ≤ the supplied answer rate. The default curve matches
// the iter-132 hardcoded thresholds so existing deploys see no
// behavior change until an admin opts in.
//
// Validation rules enforced at write time (see /api/settings/pacing):
//   - 2..10 steps
//   - min_rate strictly decreasing
//   - dial_level > 0 and < 100
//   - exactly one step with min_rate = 0 (catch-all bottom)

export interface PacingThresholdStep {
  /** Answer rate (0..1) — INCLUSIVE lower bound for this step. */
  min_rate: number;
  /** dial_level recommended at this step. */
  dial_level: number;
}

export const PACING_THRESHOLDS_DEFAULT: PacingThresholdStep[] = [
  { min_rate: 0.5, dial_level: 1.0 },
  { min_rate: 0.25, dial_level: 1.5 },
  { min_rate: 0.15, dial_level: 2.0 },
  { min_rate: 0.05, dial_level: 3.0 },
  { min_rate: 0, dial_level: 4.0 },
];

export function getPacingThresholds(): PacingThresholdStep[] {
  const raw = getAppSetting(APP_SETTING_KEYS.pacingThresholds);
  if (!raw) return PACING_THRESHOLDS_DEFAULT;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return PACING_THRESHOLDS_DEFAULT;
    const out: PacingThresholdStep[] = [];
    for (const v of parsed) {
      if (typeof v !== 'object' || v === null) continue;
      const o = v as Record<string, unknown>;
      const min_rate = Number(o.min_rate);
      const dial_level = Number(o.dial_level);
      if (
        !Number.isFinite(min_rate) ||
        !Number.isFinite(dial_level) ||
        min_rate < 0 ||
        min_rate > 1 ||
        dial_level <= 0
      )
        continue;
      out.push({ min_rate, dial_level });
    }
    if (out.length === 0) return PACING_THRESHOLDS_DEFAULT;
    out.sort((a, b) => b.min_rate - a.min_rate);
    return out;
  } catch {
    return PACING_THRESHOLDS_DEFAULT;
  }
}

export function setPacingThresholds(steps: PacingThresholdStep[]): void {
  if (steps.length < 2 || steps.length > 10) {
    throw new Error('Pacing thresholds must have between 2 and 10 steps.');
  }
  const sorted = [...steps].sort((a, b) => b.min_rate - a.min_rate);
  // Validate strict decreasing min_rate.
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.min_rate >= sorted[i - 1]!.min_rate) {
      throw new Error(
        'Each step\'s min_rate must be strictly lower than the previous.',
      );
    }
  }
  if (sorted[sorted.length - 1]!.min_rate !== 0) {
    throw new Error(
      'The lowest step must have min_rate=0 (catch-all bottom).',
    );
  }
  for (const s of sorted) {
    if (s.dial_level <= 0 || s.dial_level >= 100) {
      throw new Error(
        'dial_level for each step must be > 0 and < 100.',
      );
    }
    if (s.min_rate < 0 || s.min_rate > 1) {
      throw new Error('min_rate for each step must be in 0..1.');
    }
  }
  setAppSetting(APP_SETTING_KEYS.pacingThresholds, JSON.stringify(sorted));
}

export function clearPacingThresholds(): void {
  clearAppSetting(APP_SETTING_KEYS.pacingThresholds);
}

// Iter 163 — Wrap-up enforcement toggle. Off by default to keep
// existing deployments behaving as before; admin opts in via
// /settings/wrapup-enforcement.
export function getWrapupEnforcementEnabled(): boolean {
  return (
    getAppSetting(APP_SETTING_KEYS.wrapupEnforcementEnabled) === '1'
  );
}

export function setWrapupEnforcementEnabled(enabled: boolean): void {
  setAppSetting(
    APP_SETTING_KEYS.wrapupEnforcementEnabled,
    enabled ? '1' : '0',
  );
}

// Iter 166 — Per-lead frequency cap. Off by default. Defaults are
// FCC-conservative when enabled: max 3 calls per 24h to the same
// phone. Operators tighten or loosen via /settings/frequency-caps.
export const FREQ_CAP_DEFAULT_COUNT = 3;
export const FREQ_CAP_DEFAULT_WINDOW_HOURS = 24;

export function getFreqCapEnabled(): boolean {
  return getAppSetting(APP_SETTING_KEYS.freqCapEnabled) === '1';
}

export function setFreqCapEnabled(enabled: boolean): void {
  setAppSetting(APP_SETTING_KEYS.freqCapEnabled, enabled ? '1' : '0');
}

export function getFreqCapLeadCount(): number {
  const raw = getAppSetting(APP_SETTING_KEYS.freqCapLeadCount);
  const n = raw ? parseInt(raw, 10) : FREQ_CAP_DEFAULT_COUNT;
  return Number.isFinite(n) && n > 0 ? n : FREQ_CAP_DEFAULT_COUNT;
}

export function setFreqCapLeadCount(n: number): void {
  const clamped = Math.max(1, Math.min(50, Math.floor(n)));
  setAppSetting(APP_SETTING_KEYS.freqCapLeadCount, String(clamped));
}

export function getFreqCapLeadWindowHours(): number {
  const raw = getAppSetting(APP_SETTING_KEYS.freqCapLeadWindowHours);
  const n = raw ? parseInt(raw, 10) : FREQ_CAP_DEFAULT_WINDOW_HOURS;
  return Number.isFinite(n) && n > 0 ? n : FREQ_CAP_DEFAULT_WINDOW_HOURS;
}

export function setFreqCapLeadWindowHours(n: number): void {
  const clamped = Math.max(1, Math.min(720, Math.floor(n)));
  setAppSetting(APP_SETTING_KEYS.freqCapLeadWindowHours, String(clamped));
}
