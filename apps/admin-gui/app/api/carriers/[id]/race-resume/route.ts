import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  getCarrier,
  setCarrierRacePausedUntil,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 187 — Manual override: clear race_paused_until on a
// carrier so it rejoins the rotation immediately.

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
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
  const { id } = await ctx.params;
  const carrier = getCarrier(id);
  if (!carrier) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const wasPaused = carrier.race_paused_until;
  setCarrierRacePausedUntil(id, null);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'carrier.race_resumed',
    targetType: 'carrier',
    targetId: id,
    payload: { was_paused_until: wasPaused },
  });
  return NextResponse.json({ ok: true });
}
