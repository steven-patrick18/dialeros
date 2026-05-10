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
} as const;
