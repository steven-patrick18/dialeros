import { NextRequest, NextResponse } from 'next/server';
import {
  NodeRolesSchema,
  appendAudit,
  getNodeFromDb,
  parseNodeRoles,
  updateNodeRoles,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 61 — overwrite a node's roles array. Admin-only.

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const existing = getNodeFromDb(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    roles?: unknown;
  };
  const parsed = NodeRolesSchema.safeParse(body.roles);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? 'Invalid roles array',
      },
      { status: 400 },
    );
  }

  const changed = updateNodeRoles(id, parsed.data);
  if (!changed) {
    return NextResponse.json(
      { error: 'No change applied' },
      { status: 409 },
    );
  }

  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'node.roles_updated',
    targetType: 'node',
    targetId: id,
    payload: {
      from: parseNodeRoles(existing),
      to: parsed.data,
    },
  });

  return NextResponse.json({ ok: true });
}
