import { NextRequest, NextResponse } from 'next/server';
import {
  RoutePlanInputSchema,
  appendAudit,
  createRoutePlan,
  listRoutePlans,
  parseCidPool,
  parseFailoverIds,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const plans = listRoutePlans().map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    primary_carrier_id: p.primary_carrier_id,
    failover_carrier_ids: parseFailoverIds(p),
    cid_strategy: p.cid_strategy,
    cid_pool_size: parseCidPool(p).length,
    enabled: p.enabled === 1,
    created_at: p.created_at,
  }));
  return NextResponse.json({ route_plans: plans });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = RoutePlanInputSchema.safeParse(raw);
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
    const result = createRoutePlan(parsed.data);
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'route_plan.created',
      targetType: 'route_plan',
      targetId: result.id,
      payload: {
        name: parsed.data.name,
        primary_carrier_id: parsed.data.primary_carrier_id,
        failover_count: parsed.data.failover_carrier_ids.length,
        cid_strategy: parsed.data.cid_strategy,
      },
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Failed to create route plan';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
