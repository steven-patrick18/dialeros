import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { appendAudit } from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';
import { eslApi } from '@/lib/esl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 118 — attended transfer, completion.
//
// Bridges the held customer leg to the consult target leg.
// FS's `uuid_bridge <customer_uuid> <consult_uuid>` drops the
// agent and connects customer ↔ consult target directly. The
// agent's softphone sees both legs hang up.
//
// We rely on the client to remember the two uuids returned by
// /consult — keeps server state to zero. If the agent refreshes
// mid-consult they'd lose the transfer flow; iter 119 may add a
// transient agent_active_transfers row for refresh-survivability.

const Body = z.object({
  original_uuid: z.string().min(8).max(40),
  consult_uuid: z.string().min(8).max(40),
});

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }
  const { original_uuid, consult_uuid } = parsed.data;

  // Bridge: customer ↔ consult target. uuid_bridge is symmetric
  // and FS handles the SIP re-INVITEs to drop the agent cleanly.
  try {
    await eslApi(`uuid_bridge ${original_uuid} ${consult_uuid}`);
  } catch (e) {
    return NextResponse.json(
      {
        error: `Bridge failed: ${(e as Error).message ?? 'unknown'}`,
      },
      { status: 502 },
    );
  }

  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'agent.transfer_completed',
    targetType: 'dial_intent',
    targetId: original_uuid,
    payload: { original_uuid, consult_uuid },
  });

  return NextResponse.json({ ok: true });
}
