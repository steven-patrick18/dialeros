import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  deleteInGroup,
  getInGroup,
  getInGroupDids,
  parseStaticWhitelist,
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
  const g = getInGroup(id);
  if (!g) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({
    id: g.id,
    name: g.name,
    description: g.description,
    type: g.type,
    whitelist_mode: g.whitelist_mode,
    whitelist_static: parseStaticWhitelist(g),
    routing_strategy: g.routing_strategy,
    max_wait_seconds: g.max_wait_seconds,
    wrap_up_seconds: g.wrap_up_seconds,
    off_list_action: g.off_list_action,
    enabled: g.enabled === 1,
    dids: getInGroupDids(id),
    created_at: g.created_at,
    updated_at: g.updated_at,
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
  const existing = getInGroup(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const ok = deleteInGroup(id);
  if (!ok) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'in_group.deleted',
    targetType: 'in_group',
    targetId: id,
    payload: { name: existing.name },
  });
  return NextResponse.json({ ok: true });
}
