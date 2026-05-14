import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  getRoutePlan,
  setRoutePlanParallelRace,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 183 — Update a route plan's parallel race configuration.
// Admin-only.

export async function PUT(
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
  if (!getRoutePlan(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const obj = body as { enabled?: unknown; carrier_ids?: unknown };
  if (typeof obj.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'enabled must be boolean' },
      { status: 400 },
    );
  }
  if (!Array.isArray(obj.carrier_ids)) {
    return NextResponse.json(
      { error: 'carrier_ids must be an array' },
      { status: 400 },
    );
  }
  const ids = obj.carrier_ids.filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  if (obj.enabled && ids.length < 2) {
    return NextResponse.json(
      { error: 'enabled race requires at least 2 carriers' },
      { status: 400 },
    );
  }
  if (ids.length > 4) {
    return NextResponse.json(
      { error: 'at most 4 carriers in a race' },
      { status: 400 },
    );
  }
  setRoutePlanParallelRace(id, obj.enabled, ids);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'route_plan.parallel_race',
    targetType: 'route_plan',
    targetId: id,
    payload: { enabled: obj.enabled, carrier_ids: ids },
  });
  return NextResponse.json({ ok: true });
}
