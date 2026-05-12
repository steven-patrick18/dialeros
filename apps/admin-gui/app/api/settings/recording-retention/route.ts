import { NextRequest, NextResponse } from 'next/server';
import {
  getRecordingRetentionDays,
  setRecordingRetentionDays,
  getRecordingRetentionEnabled,
  setRecordingRetentionEnabled,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 144 — read + write the recording-retention knobs. Admin
// only. Persists via the encrypted app_settings table (same store
// as iter 28's signalwire-token, iter 134's pacing thresholds).

async function requireAdmin() {
  const me = await getCurrentUser();
  if (!me) return { error: 'Unauthorized', status: 401 } as const;
  if (me.role !== 'admin') {
    return { error: 'Admin role required', status: 403 } as const;
  }
  return { ok: true } as const;
}

export async function GET() {
  const auth = await requireAdmin();
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  return NextResponse.json({
    retention_days: getRecordingRetentionDays(),
    enabled: getRecordingRetentionEnabled(),
  });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const obj = body as {
    retention_days?: unknown;
    enabled?: unknown;
  };
  if (obj.retention_days !== undefined) {
    const n = Number(obj.retention_days);
    if (!Number.isFinite(n) || n < 1 || n > 3650) {
      return NextResponse.json(
        { error: 'retention_days must be an integer between 1 and 3650' },
        { status: 400 },
      );
    }
    setRecordingRetentionDays(n);
  }
  if (obj.enabled !== undefined) {
    setRecordingRetentionEnabled(Boolean(obj.enabled));
  }
  return NextResponse.json({
    retention_days: getRecordingRetentionDays(),
    enabled: getRecordingRetentionEnabled(),
  });
}
