import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  provisionUserForRemoteAgent,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Iter 90 — auto-provision a User + Phone backing a Remote Agent.
 * Returns plaintext SIP + login passwords ONCE so the admin can
 * configure the external hard phone. Stored only as hashes / SIP
 * realm secrets after this call returns.
 *
 * Admin-only. The result is single-use sensitive material; the
 * audit row stores user_id + phone_id but NOT the passwords.
 */
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
  const result = provisionUserForRemoteAgent(id);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'remote_agent.user_provisioned',
    targetType: 'remote_agent',
    targetId: id,
    payload: {
      user_id: result.user_id,
      username: result.username,
      phone_id: result.phone_id,
      extension: result.extension,
    },
  });
  return NextResponse.json(result);
}
