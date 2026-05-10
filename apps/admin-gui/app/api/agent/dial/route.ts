import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  applyDialPlanRule,
  carrierAcceptsDestination,
  extensionForUser,
  findMatchingDialPlanRule,
  getCarrier,
  getPrimaryPhone,
  getRoutePlan,
  getUser,
  getUserCampaignIds,
  listCampaigns,
  normalizePhone,
  parseCidPool,
  rotateDialPlanCursor,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';
import { originate } from '@/lib/esl';
import { gatewayNameFor } from '@/lib/freeswitch-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 40 — manual dial from the agent softphone. Only users with
// manual_dial=1 are allowed; everyone else only auto-answers
// pacer-bridged calls.
//
// Routing: pick the user's first attached active outbound campaign,
// use its route plan + primary carrier. Originate via ESL with
// `&bridge(user/<agent_ext>)` so once the destination answers, the
// agent's browser softphone (which is registered as user/<ext>) auto-
// answers and bridges in. Same shape the pacer uses, so all the
// hangup-correlation + lead-status logic still applies if we wire it
// up later — for now the call is logged in audit only.

const Body = z.object({
  destination: z.string().min(2).max(40),
  // Iter 47 — agent-supplied caller ID override. If absent the route
  // plan's CID strategy (single / rotate) is used as before.
  cid: z.string().min(0).max(40).optional(),
});

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userRow = getUser(me.id);
  if (!userRow || userRow.manual_dial !== 1) {
    return NextResponse.json(
      { error: 'Manual dial is not enabled for this user.' },
      { status: 403 },
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }
  const dest = normalizePhone(parsed.data.destination);
  if (!dest) {
    return NextResponse.json(
      { error: 'Destination phone format is invalid.' },
      { status: 400 },
    );
  }

  // Iter 48 — any active campaign the agent is attached to is fair
  // game for manual outbound. The campaign's `type` is about how it
  // gets paced (auto-dial vs wait-for-incoming), not about whether
  // outbound is allowed: every campaign carries a route_plan + cid
  // strategy, and a manual call can ride that. Outbound types still
  // sort first when the user is in both kinds.
  const myIds = new Set(getUserCampaignIds(me.id));
  const campaigns = listCampaigns()
    .filter(
      (c) =>
        c.status === 'active' && (myIds.has(c.id) || me.role === 'admin'),
    )
    .sort((a, b) => {
      const inboundA = a.type === 'inbound_queue' ? 1 : 0;
      const inboundB = b.type === 'inbound_queue' ? 1 : 0;
      return inboundA - inboundB;
    });
  const campaign = campaigns[0];
  if (!campaign) {
    return NextResponse.json(
      {
        error: 'No active campaign attached. Ask an admin to attach one.',
      },
      { status: 409 },
    );
  }
  const route = getRoutePlan(campaign.route_plan_id);
  if (!route) {
    return NextResponse.json(
      { error: 'Campaign has no route plan.' },
      { status: 409 },
    );
  }
  const carrier = getCarrier(route.primary_carrier_id);
  if (!carrier) {
    return NextResponse.json(
      { error: 'Route plan primary carrier is missing.' },
      { status: 409 },
    );
  }
  // Iter 44 — surface the prefix mismatch up-front so the agent gets a
  // clear message instead of a confusing originate failure.
  if (!carrierAcceptsDestination(carrier, dest)) {
    return NextResponse.json(
      {
        error: `Carrier ${carrier.name} does not accept this destination prefix.`,
      },
      { status: 409 },
    );
  }

  // Iter 45 — apply carrier dial-plan rewrite rules so manual dials
  // get the same prefix translation as pacer-driven calls. Shared
  // rotation cursor with the pacer keeps load distribution
  // predictable across sources.
  let dialDest = dest;
  const matchedRule = findMatchingDialPlanRule(carrier, dest);
  if (matchedRule) {
    const cursor = rotateDialPlanCursor(carrier.id, matchedRule.ruleIndex);
    dialDest = applyDialPlanRule(matchedRule.rule, dest, cursor);
  }
  // Iter 47 — agent override wins over the route plan default. Pass
  // through normalizePhone for canonical form; reject obviously bad
  // input early instead of confusing the carrier with garbage in
  // From/PAI.
  let cid: string | null = null;
  if (parsed.data.cid && parsed.data.cid.trim().length > 0) {
    const overrideCid = normalizePhone(parsed.data.cid);
    if (!overrideCid) {
      return NextResponse.json(
        { error: 'CID override has invalid phone format.' },
        { status: 400 },
      );
    }
    cid = overrideCid;
  } else if (route.cid_strategy === 'single') {
    cid = route.cid_single;
  } else if (route.cid_strategy === 'rotate') {
    cid = parseCidPool(route)[0] ?? null;
  }

  // The agent's softphone extension — primary phone if any, else hash.
  const primary = getPrimaryPhone(me.id);
  const agentExtension = primary?.extension ?? extensionForUser(me.id);

  const gateway = gatewayNameFor(carrier);
  let uuid: string;
  try {
    uuid = await originate({
      gateway,
      destination: dialDest,
      callerIdNumber: cid ?? undefined,
      app: `&bridge(user/${agentExtension})`,
      originateTimeout: 30,
    });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'agent.manual_dial_failed',
      targetType: 'campaign',
      targetId: campaign.id,
      payload: {
        to: dest,
        dialed: dialDest,
        cid,
        error: err.message ?? 'unknown',
      },
    });
    return NextResponse.json(
      {
        ok: false,
        error: err.message ?? 'originate failed',
        code: err.code ?? 'unknown',
      },
      { status: 502 },
    );
  }

  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'agent.manual_dial',
    targetType: 'campaign',
    targetId: campaign.id,
    payload: {
      uuid,
      to: dest,
      dialed: dialDest,
      cid,
      campaign_name: campaign.name,
    },
  });

  return NextResponse.json({
    ok: true,
    uuid,
    to: dest,
    dialed: dialDest,
    cid,
    campaign: campaign.name,
  });
}
