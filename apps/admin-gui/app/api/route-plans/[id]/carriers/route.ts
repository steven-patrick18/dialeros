import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  PlanCarrierRowSchema,
  appendAudit,
  getRoutePlan,
  inFlightForCarrier,
  listCarriersForRoutePlan,
  setRoutePlanCarriers,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const plan = getRoutePlan(id);
  if (!plan) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const rows = listCarriersForRoutePlan(id).map((r) => ({
    id: r.id,
    carrier_id: r.carrier_id,
    priority: r.priority,
    ports: r.ports,
    in_flight: inFlightForCarrier(r.carrier_id),
  }));
  return NextResponse.json({ carriers: rows });
}

const PutBodySchema = z.object({
  carriers: z.array(PlanCarrierRowSchema).min(1, 'At least one carrier.'),
});

export async function PUT(
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
  const plan = getRoutePlan(id);
  if (!plan) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = PutBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
          .join('; '),
      },
      { status: 400 },
    );
  }
  try {
    const inserted = setRoutePlanCarriers(id, parsed.data.carriers);
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'route_plan.carriers_replaced',
      targetType: 'route_plan',
      targetId: id,
      payload: {
        name: plan.name,
        carriers: parsed.data.carriers,
      },
    });
    return NextResponse.json({ ok: true, count: inserted });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Failed to update carriers';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
