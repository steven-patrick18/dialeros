import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  carrierAcceptsDestination,
  extensionForUser,
  getCampaign,
  getCarrier,
  getPrimaryPhone,
  getRoutePlan,
  latestUndisposedIntentForUser,
  normalizePhone,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';
import { eslApi } from '@/lib/esl';
import { gatewayNameFor } from '@/lib/freeswitch-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 118 — attended transfer, consult leg.
//
// Flow:
//   1. Agent is on a bridged call with the customer (their latest
//      undisposed dial_intent has a non-null call_uuid).
//   2. Agent clicks "Consult" in the transfer modal and types
//      either a SIP extension (1001) or an external number.
//   3. We HOLD the customer leg via `uuid_phone_event hold` so
//      they hear MOH while the agent has a sidebar.
//   4. We originate a new outbound call to the consult target
//      and bridge it to the agent's softphone. The agent and the
//      consult target can now talk privately.
//   5. We return the consult call uuid so the client can pass it
//      to /complete or /cancel.
//
// FS verification points (real-box smoke tests on first deploy):
//   - `uuid_phone_event <uuid> hold` requires sofia_endpoint and
//     a working MOH source on the customer leg's profile.
//   - The originate must succeed against the same gateway the
//     pacer / manual dial uses. We reuse extensionForUser so the
//     bridge target is the agent's own primary phone.

const Body = z.object({
  destination: z.string().min(1).max(40),
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
  const target = parsed.data.destination.trim();

  // Find the agent's active customer leg. Without one there's
  // nothing to put on hold + nothing to complete a transfer to.
  const active = latestUndisposedIntentForUser(me.id);
  if (!active || !active.call_uuid || active.hangup_at) {
    return NextResponse.json(
      { error: 'No active bridged call to transfer.' },
      { status: 409 },
    );
  }

  // Hold the customer leg. uuid_phone_event 'hold' triggers FS's
  // SIP hold semantics (re-INVITE with a=sendonly + MOH).
  try {
    await eslApi(`uuid_phone_event ${active.call_uuid} hold`);
  } catch (e) {
    return NextResponse.json(
      {
        error: `Could not hold customer leg: ${(e as Error).message ?? 'unknown'}`,
      },
      { status: 502 },
    );
  }

  // Resolve agent's softphone extension — same primary-phone path
  // the pacer uses to bridge.
  const primary = getPrimaryPhone(me.id);
  const agentExt = primary?.extension ?? extensionForUser(me.id);

  // For internal extensions (digits-only, 3-6 chars) we dial them
  // directly via user/<ext>; otherwise we treat the input as an
  // external destination and route through the agent's default
  // gateway. For attended transfer the bridge target is always
  // the agent — they're the one having the consult conversation.
  const isInternalExt = /^\d{3,6}$/.test(target);
  let originateLeg: string;
  if (isInternalExt) {
    originateLeg = `user/${target}`;
  } else {
    const dest = normalizePhone(target);
    if (!dest) {
      return NextResponse.json(
        { error: 'External target phone is not a valid format.' },
        { status: 400 },
      );
    }
    // Iter 121 — pick the gateway from the same campaign + route
    // plan the active call is on. This is the same resolution
    // path /api/agent/dial uses for manual dials, so a consult
    // out the carrier rides identical routing + dial-prefix +
    // CID strategy as the original call. Iter 118 had this
    // hardcoded to `dialeros-default`, which only worked when an
    // operator happened to name their gateway that.
    const campaign = getCampaign(active.campaign_id);
    if (!campaign) {
      return NextResponse.json(
        {
          error:
            'Active call campaign no longer exists; cannot route external consult.',
        },
        { status: 409 },
      );
    }
    const plan = getRoutePlan(campaign.route_plan_id);
    if (!plan) {
      return NextResponse.json(
        { error: 'Active campaign has no route plan.' },
        { status: 409 },
      );
    }
    const carrier = getCarrier(plan.primary_carrier_id);
    if (!carrier) {
      return NextResponse.json(
        { error: 'Route plan primary carrier is missing.' },
        { status: 409 },
      );
    }
    if (!carrierAcceptsDestination(carrier, dest)) {
      return NextResponse.json(
        {
          error: `Carrier ${carrier.name} does not accept this destination prefix.`,
        },
        { status: 409 },
      );
    }
    const gateway = gatewayNameFor(carrier);
    originateLeg = `sofia/gateway/${gateway}/${dest}`;
  }

  // Originate the consult leg, bridging the agent in. Generate a
  // dedicated channel uuid so we can refer to this leg explicitly
  // when completing or cancelling the transfer.
  const consultUuid = crypto.randomUUID();
  const vars = `{origination_uuid=${consultUuid},dialeros_consult_of=${active.call_uuid},hangup_after_bridge=true}`;
  const cmd = `bgapi originate ${vars}${originateLeg} &bridge(user/${agentExt})`;
  try {
    await eslApi(cmd);
  } catch (e) {
    // Best effort: try to unhold the customer leg so they don't
    // sit listening to MOH forever after a failed consult.
    try {
      await eslApi(`uuid_phone_event ${active.call_uuid} unhold`);
    } catch {
      /* ignore */
    }
    return NextResponse.json(
      {
        error: `Originate consult leg failed: ${(e as Error).message ?? 'unknown'}`,
      },
      { status: 502 },
    );
  }

  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'agent.transfer_consult',
    targetType: 'dial_intent',
    targetId: String(active.id),
    payload: {
      original_uuid: active.call_uuid,
      consult_uuid: consultUuid,
      target,
    },
  });

  return NextResponse.json({
    ok: true,
    original_uuid: active.call_uuid,
    consult_uuid: consultUuid,
    target,
  });
}
