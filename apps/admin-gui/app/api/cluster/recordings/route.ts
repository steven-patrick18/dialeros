import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  getRecordingRetentionDays,
  sweepRecordingsOnce,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 113 — recordings disk-use stats + manual sweep trigger for
// the /cluster page. GET returns size/count/age summary; POST
// fires sweepOnce() and audits. Both gated to admin/supervisor —
// the recordings tree contains call audio so we don't expose the
// stat surface to agents.

const RECORDINGS_ROOT = '/var/lib/dialeros/recordings';

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return NextResponse.json(
      { error: 'Admin or supervisor role required' },
      { status: 403 },
    );
  }

  const retentionDays = getRecordingRetentionDays();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  let names: string[] = [];
  try {
    names = await readdir(RECORDINGS_ROOT);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      // No recordings dir yet (fresh install / dev box) — return
      // empties so the UI can render an unobtrusive "0 recordings"
      // line rather than an error.
      return NextResponse.json({
        path: RECORDINGS_ROOT,
        exists: false,
        total_bytes: 0,
        file_count: 0,
        expirable_count: 0,
        oldest_age_days: null,
        retention_days: retentionDays,
      });
    }
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'readdir failed',
      },
      { status: 500 },
    );
  }

  let totalBytes = 0;
  let fileCount = 0;
  let expirable = 0;
  let oldestMs: number | null = null;
  for (const name of names) {
    if (!name.endsWith('.wav')) continue;
    try {
      const s = await stat(resolve(RECORDINGS_ROOT, name));
      if (!s.isFile()) continue;
      totalBytes += s.size;
      fileCount++;
      if (s.mtimeMs < cutoff) expirable++;
      if (oldestMs === null || s.mtimeMs < oldestMs) oldestMs = s.mtimeMs;
    } catch {
      /* file vanished between readdir/stat — skip */
    }
  }
  const oldestAgeDays =
    oldestMs === null
      ? null
      : Math.floor((Date.now() - oldestMs) / (24 * 60 * 60 * 1000));

  return NextResponse.json({
    path: RECORDINGS_ROOT,
    exists: true,
    total_bytes: totalBytes,
    file_count: fileCount,
    expirable_count: expirable,
    oldest_age_days: oldestAgeDays,
    retention_days: retentionDays,
  });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return NextResponse.json(
      { error: 'Admin or supervisor role required' },
      { status: 403 },
    );
  }
  try {
    const removed = await sweepRecordingsOnce();
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'recordings.sweep_manual',
      targetType: 'cluster',
      targetId: 'recordings',
      payload: { removed },
    });
    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'sweep failed',
      },
      { status: 500 },
    );
  }
}
