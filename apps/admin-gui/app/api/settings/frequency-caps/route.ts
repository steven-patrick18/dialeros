import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  getFreqCapEnabled,
  getFreqCapLeadCount,
  getFreqCapLeadWindowHours,
  setFreqCapEnabled,
  setFreqCapLeadCount,
  setFreqCapLeadWindowHours,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 166 — Frequency cap settings. Admin only.

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    enabled: getFreqCapEnabled(),
    lead_count: getFreqCapLeadCount(),
    lead_window_hours: getFreqCapLeadWindowHours(),
  });
}

export async function PUT(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin role required' },
      { status: 403 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const obj = body as {
    enabled?: unknown;
    lead_count?: unknown;
    lead_window_hours?: unknown;
  };
  if (typeof obj.enabled === 'boolean') {
    setFreqCapEnabled(obj.enabled);
  }
  if (obj.lead_count !== undefined) {
    const n = Number(obj.lead_count);
    if (!Number.isFinite(n) || n < 1 || n > 50) {
      return NextResponse.json(
        { error: 'lead_count must be 1-50' },
        { status: 400 },
      );
    }
    setFreqCapLeadCount(n);
  }
  if (obj.lead_window_hours !== undefined) {
    const n = Number(obj.lead_window_hours);
    if (!Number.isFinite(n) || n < 1 || n > 720) {
      return NextResponse.json(
        { error: 'lead_window_hours must be 1-720' },
        { status: 400 },
      );
    }
    setFreqCapLeadWindowHours(n);
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'settings.frequency_caps',
    targetType: 'app_setting',
    targetId: 'freq_cap',
    payload: {
      enabled: getFreqCapEnabled(),
      lead_count: getFreqCapLeadCount(),
      lead_window_hours: getFreqCapLeadWindowHours(),
    },
  });
  return NextResponse.json({
    enabled: getFreqCapEnabled(),
    lead_count: getFreqCapLeadCount(),
    lead_window_hours: getFreqCapLeadWindowHours(),
  });
}
