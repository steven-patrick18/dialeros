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
