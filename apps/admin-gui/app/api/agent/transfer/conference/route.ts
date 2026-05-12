import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { appendAudit } from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';
import { eslApi } from '@/lib/esl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 120 — 3-way conference completion for the attended-transfer
// flow. Where iter 118's /complete bridges customer ↔ consult and
// drops the agent, /conference keeps all THREE legs in the call:
// customer + consult target + agent. Use cases:
//   - Warm hand-off where the agent introduces the customer to a
//     specialist and stays on for a moment.
//   - Escalation: agent loops in a supervisor without leaving the
//     call.
//   - Trainer + trainee + customer simultaneously.
//
// FS mechanics:
//   1. uuid_getvar <customer_uuid> bridge_uuid → agent's leg uuid
//      (the other side of the customer bridge — we never tracked
//      it server-side because it lives entirely in the agent's
//      browser softphone).
//   2. Unhold the customer leg so they come off MOH.
//   3. Create a named conference room and transfer all three legs
//      into it. Conference room name uses the customer uuid prefix
//      so it's stable + easy to grep in logs.
//   4. mod_conference handles N-way mixing from there.
//
// FS verification points (real-box smoke test on first deploy):
//   - mod_conference loaded + default profile present
//   - `uuid_transfer <uuid> conference:<room>@default` actually
//     pulls the leg into the conference without dropping its peer.
//     If FS does drop the peer (it does in some configurations),
//     we'll need to switch to originate-into-conference pattern.
//   - bridge_uuid is the right variable name across FS versions
//     (it's been stable since 1.8 but worth checking on the box).

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

  // Resolve the agent's actual call-leg uuid from FS. The
  // customer's bridge_uuid points at the agent's softphone
  // channel — that's the one we need to pull into the conference
  // alongside the other two legs.
  let agentLegUuid: string | null = null;
  try {
    const reply = (
      await eslApi(`uuid_getvar ${original_uuid} bridge_uuid`)
    ).trim();
    if (reply && reply !== '_undef_' && !reply.startsWith('-ERR')) {
      agentLegUuid = reply;
    }
  } catch {
    // If we can't resolve it, we'll still try to conference the
    // two known legs — the agent's softphone may end up dropped
    // but customer ↔ consult will land in the room.
  }

  // Conference room name — stable + traceable. Stamp with the
  // customer uuid so concurrent transfers don't collide.
  const room = `xfer-${original_uuid.slice(0, 12)}`;

  // Unhold the customer so they're audible to the conference. If
  // they're already unheld this is a no-op.
  try {
    await eslApi(`uuid_phone_event ${original_uuid} unhold`);
  } catch {
    /* customer might already be unheld — proceed */
  }

  // Pull each leg into the conference. We do it in deliberate
  // order — consult first (the agent's existing audio path), then
  // customer (came off hold), then agent's softphone leg if we
  // resolved it. mod_conference creates the room on first
  // transfer; subsequent transfers join it.
  const transfers: Array<{ leg: string; uuid: string }> = [
    { leg: 'consult', uuid: consult_uuid },
    { leg: 'customer', uuid: original_uuid },
  ];
  if (agentLegUuid) {
    transfers.push({ leg: 'agent', uuid: agentLegUuid });
  }

  const failures: Array<{ leg: string; error: string }> = [];
  for (const t of transfers) {
    try {
      await eslApi(`uuid_transfer ${t.uuid} conference:${room}@default inline`);
    } catch (e) {
      failures.push({
        leg: t.leg,
        error: (e as Error).message ?? 'unknown',
      });
    }
  }

  if (failures.length === transfers.length) {
    return NextResponse.json(
      {
        error: 'All conference transfers failed',
        failures,
      },
      { status: 502 },
    );
  }

  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'agent.transfer_conferenced',
    targetType: 'dial_intent',
    targetId: original_uuid,
    payload: {
      original_uuid,
      consult_uuid,
      agent_leg_uuid: agentLegUuid,
      room,
      partial_failures: failures.length > 0 ? failures : undefined,
    },
  });

  return NextResponse.json({
    ok: true,
    room,
    partial_failures: failures.length > 0 ? failures : undefined,
  });
}
