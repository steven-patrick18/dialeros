import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  getCidGroup,
  removeCidFromGroup,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; numberId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id, numberId } = await ctx.params;
  const group = getCidGroup(id);
  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }
  const removed = removeCidFromGroup(numberId);
  if (!removed) {
    return NextResponse.json({ error: 'Number not found' }, { status: 404 });
  }
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'cid_group.number_removed',
    targetType: 'cid_group',
    targetId: id,
    payload: { number_id: numberId },
  });
  return NextResponse.json({ ok: true });
}
