import { NextRequest, NextResponse } from 'next/server';
import { appendAudit, getCarrier } from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';
import { pushCarrierToFreeSwitch } from '@/lib/freeswitch-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const carrier = getCarrier(id);
  if (!carrier) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const result = await pushCarrierToFreeSwitch(carrier);

  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'carrier.push_to_freeswitch',
    targetType: 'carrier',
    targetId: id,
    payload: {
      ok: result.ok,
      step: result.step,
      gateway: result.gatewayName,
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        step: result.step,
        error: result.message,
        gateway: result.gatewayName,
      },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    gateway: result.gatewayName,
    message: result.message,
  });
}
