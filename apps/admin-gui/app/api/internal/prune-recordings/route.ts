import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  getRecordingRetentionDays,
  getRecordingRetentionEnabled,
  clearRecordingPathsForFiles,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 144 — Recording retention prune.
//
// Triggered two ways:
//   1. systemd timer (dialeros-prune-recordings.timer, 03:30 daily)
//      via /opt/dialeros/scripts/prune-recordings.py, auth'd with
//      X-Inbound-Token (shared secret in /etc/dialeros/admin.env).
//   2. "Prune now" button on /settings/recording-retention — uses
//      the admin session cookie instead of the token.
//
// Body:
//   ?dry_run=1 — scan + report but DO NOT delete. Used by the
//                Prune-now button's "Preview" mode so an operator
//                can see how many files would go before committing.
//
// Returns:
//   { enabled, retention_days, cutoff_iso, scanned, deleted,
//     freed_bytes, db_rows_cleared, dry_run, errors[] }
//
// Quietly skips when enabled === false; the response still 200s
// with enabled:false so cron logs aren't full of errors.

const RECORDINGS_ROOT = '/var/lib/dialeros/recordings';

async function authorized(req: NextRequest): Promise<boolean> {
  const expected = process.env.KAMAILIO_INBOUND_TOKEN;
  if (expected) {
    const header = req.headers.get('x-inbound-token');
    if (header && header === expected) return true;
  }
  const me = await getCurrentUser();
  return Boolean(me && me.role === 'admin');
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get('dry_run') === '1';
  const enabled = getRecordingRetentionEnabled();
  const retentionDays = getRecordingRetentionDays();
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  if (!enabled) {
    return NextResponse.json({
      enabled,
      retention_days: retentionDays,
      cutoff_iso: cutoffIso,
      scanned: 0,
      deleted: 0,
      freed_bytes: 0,
      db_rows_cleared: 0,
      dry_run: dryRun,
      errors: [],
      note: 'retention disabled — toggle on /settings/recording-retention to enable',
    });
  }

  let names: string[];
  try {
    names = await readdir(RECORDINGS_ROOT);
  } catch (e) {
    return NextResponse.json(
      {
        enabled,
        retention_days: retentionDays,
        cutoff_iso: cutoffIso,
        scanned: 0,
        deleted: 0,
        freed_bytes: 0,
        db_rows_cleared: 0,
        dry_run: dryRun,
        errors: [`readdir failed: ${(e as Error).message}`],
      },
      { status: 200 },
    );
  }

  let scanned = 0;
  let deleted = 0;
  let freedBytes = 0;
  const errors: string[] = [];
  const deletedPaths: string[] = [];

  for (const name of names) {
    // Defensive: stay flat under the root. record_session writes
    // flat .wav files; ignore subdirs / non-wav files so a hostile
    // file in the dir can't trick us into recursing.
    if (!name.toLowerCase().endsWith('.wav')) continue;
    const fullPath = resolve(join(RECORDINGS_ROOT, name));
    if (!fullPath.startsWith(RECORDINGS_ROOT + '/')) continue;
    scanned += 1;
    try {
      const st = await stat(fullPath);
      if (!st.isFile()) continue;
      if (st.mtimeMs >= cutoffMs) continue;
      // Older than cutoff — candidate.
      if (dryRun) {
        deleted += 1; // count it as "would-delete" so the preview number means something
        freedBytes += st.size;
        deletedPaths.push(fullPath);
      } else {
        await unlink(fullPath);
        deleted += 1;
        freedBytes += st.size;
        deletedPaths.push(fullPath);
      }
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  }

  // Clear the DB column. On dry_run we DO NOT touch the DB — the
  // operator might preview, change their mind, and we don't want
  // half-cleared rows. The actual prune run does both file unlink
  // + DB clear so the two stay consistent.
  let dbRowsCleared = 0;
  if (!dryRun && deletedPaths.length > 0) {
    try {
      dbRowsCleared = clearRecordingPathsForFiles(deletedPaths);
    } catch (e) {
      errors.push(`db update: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({
    enabled,
    retention_days: retentionDays,
    cutoff_iso: cutoffIso,
    scanned,
    deleted,
    freed_bytes: freedBytes,
    db_rows_cleared: dbRowsCleared,
    dry_run: dryRun,
    errors,
  });
}
