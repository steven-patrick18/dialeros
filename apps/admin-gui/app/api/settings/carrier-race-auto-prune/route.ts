import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  getCarrierRaceAutoPruneConfig,
  normalizeAutoPruneConfig,
  setCarrierRaceAutoPruneConfig,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 187 — Carrier race auto-prune config.

export async function GET() {
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
  return NextResponse.json(getCarrierRaceAutoPruneConfig());
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
  const cfg = normalizeAutoPruneConfig(body);
  setCarrierRaceAutoPruneConfig(cfg);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'settings.carrier_race_auto_prune',
    targetType: 'app_setting',
    targetId: 'carrier_race.auto_prune_config',
    payload: cfg as unknown as Record<string, unknown>,
  });
  return NextResponse.json(cfg);
}
