import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  deleteRoutePlan,
  getRoutePlan,
  parseCidPool,
  parseFailoverIds,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
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
  return NextResponse.json({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    primary_carrier_id: plan.primary_carrier_id,
    failover_carrier_ids: parseFailoverIds(plan),
    cid_strategy: plan.cid_strategy,
    cid_single: plan.cid_single,
    cid_pool: parseCidPool(plan),
    transform_strip_prefix: plan.transform_strip_prefix,
    transform_add_prefix: plan.transform_add_prefix,
    enabled: plan.enabled === 1,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
  });
}

export async function DELETE(
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
  const existing = getRoutePlan(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const ok = deleteRoutePlan(id);
  if (!ok) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'route_plan.deleted',
    targetType: 'route_plan',
    targetId: id,
    payload: { name: existing.name },
  });
  return NextResponse.json({ ok: true });
}
