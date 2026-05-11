import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  unlinkRemoteAgentUser,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Iter 90 — break the link between a Remote Agent and its backing
 * User without deleting either side. The User + Phone remain and
 * can be managed in /users; the Remote Agent goes back to having
 * no backing identity. */
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
  const ok = unlinkRemoteAgentUser(id);
  if (!ok) {
    return NextResponse.json(
      { error: 'no link to remove' },
      { status: 404 },
    );
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'remote_agent.user_unlinked',
    targetType: 'remote_agent',
    targetId: id,
    payload: {},
  });
  return NextResponse.json({ ok: true });
}
