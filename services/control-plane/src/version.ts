// Iter 188 — Single source of truth for the DialerOS version +
// build provenance. Surfaced in /api/health (uptime monitors
// track the deployed version) + the sidebar footer (operators
// see what they're running) + the release-readiness page.

export const DIALEROS_VERSION = '1.0.0';

export interface BuildInfo {
  version: string;
  // Short git SHA when DIALEROS_COMMIT is set at deploy time
  // (the VPS deploy can export it; absent in dev → 'dev').
  commit: string;
  // ISO timestamp of when the process started — a cheap "is this
  // a fresh deploy?" signal for ops.
  started_at: string;
}

const STARTED_AT = new Date().toISOString();

export function getBuildInfo(): BuildInfo {
  return {
    version: DIALEROS_VERSION,
    commit: process.env.DIALEROS_COMMIT ?? 'dev',
    started_at: STARTED_AT,
  };
}
