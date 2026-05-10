import { readdir, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getRecordingRetentionDays } from './app-settings';

// Iter 56 — call-recording retention sweep.
//
// FS writes .wav files into RECORDINGS_ROOT (flat layout, one file
// per dial_intent keyed by correlation_id). Without cleanup the disk
// fills forever. Once a day the control-plane stats every .wav and
// unlinks anything older than the configured retention window
// (default 30 days; admin-overridable via app_settings).
//
// Best-effort: errors are logged but don't crash the loop. The
// scheduler is registered from control-plane bootstrap so it runs in
// the admin-gui process — same place the pacer + fs-events live.

const RECORDINGS_ROOT = '/var/lib/dialeros/recordings';
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // every 24h
const STARTUP_DELAY_MS = 60 * 1000; // wait 60s after boot

declare global {
  // eslint-disable-next-line no-var
  var __dialeros_recording_sweep: { timer?: ReturnType<typeof setTimeout> } | undefined;
}

/**
 * Idempotent — safe to call from multiple bootstraps. Returns a
 * stopper for tests. In normal operation we never stop; the
 * scheduler runs for the life of the process.
 */
export function ensureRecordingRetentionSweep(): () => void {
  if (!globalThis.__dialeros_recording_sweep) {
    globalThis.__dialeros_recording_sweep = {};
  }
  const slot = globalThis.__dialeros_recording_sweep;
  if (slot.timer) return () => clearTimeout(slot.timer!);

  const tick = async () => {
    try {
      const removed = await sweepOnce();
      if (removed > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[recording-retention] removed ${removed} expired recording(s)`,
        );
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[recording-retention] sweep failed:', e);
    } finally {
      slot.timer = setTimeout(tick, SWEEP_INTERVAL_MS);
      slot.timer.unref?.();
    }
  };

  // Delay the first run so a quick crash-loop doesn't hammer the
  // filesystem. Subsequent runs are spaced by SWEEP_INTERVAL_MS.
  slot.timer = setTimeout(tick, STARTUP_DELAY_MS);
  slot.timer.unref?.();

  return () => clearTimeout(slot.timer!);
}

/** One-shot sweep. Returns the number of files unlinked. */
export async function sweepOnce(): Promise<number> {
  const days = getRecordingRetentionDays();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let entries: string[] = [];
  try {
    entries = await readdir(RECORDINGS_ROOT);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return 0; // dir not present yet — fine
    throw e;
  }
  let removed = 0;
  for (const name of entries) {
    if (!name.endsWith('.wav')) continue;
    const full = resolve(RECORDINGS_ROOT, name);
    try {
      const s = await stat(full);
      if (s.isFile() && s.mtimeMs < cutoff) {
        await unlink(full);
        removed++;
      }
    } catch {
      /* file vanished between readdir + stat — skip */
    }
  }
  return removed;
}
