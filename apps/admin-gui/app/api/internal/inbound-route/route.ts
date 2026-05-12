import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  findDidOwner,
  findInboundReturnMatch,
  getCampaignInGroups,
  getInGroup,
  normalizePhone,
  pickAvailableAgentForInGroup,
} from '@dialeros/control-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 114 — routing decision endpoint that Kamailio's inbound
// dialplan hits on every PSTN INVITE. Kamailio passes the called
// DID and the calling number; we answer with where (if anywhere)
// to forward the call.
//
// Two-pass routing:
//   1. INBOUND WHITELIST (iter 107) — if the `from` matches a lead
//      with status in INBOUND_WHITELIST_STATUSES, route to one of
//      the in-groups owned by that lead's last-called campaign.
//      Returns the call to the same agent flow that originally
//      contacted them (great UX for callbacks + VM responses).
//   2. DID MAPPING — if the `to` DID is mapped to an in-group via
//      in_group_dids, route there. Standard "we own this DID, send
//      it to its queue" path.
//
// Authentication: shared-secret header. Kamailio sets
// X-Inbound-Token to KAMAILIO_INBOUND_TOKEN env var; we reject any
// request without the matching value. The endpoint is mounted
// under /api/internal/ which is also blocked from the public
// internet at the nginx layer in deploy, so this is defense in
// depth — Kamailio runs on the same box.
//
// Response shapes (always 200 — Kamailio's HTTP_ASYNC behaves
// cleanly on 200s, and we want even "no match" to be observable):
//   { action: "forward", target_uri: "sip:1001@127.0.0.1:5080",
//     in_group_id, agent_id, agent_extension, reason }
//   { action: "queue",   in_group_id, reason: "no_agent_available" }
//   { action: "reject",  reason: "unmapped_did" | "missing_did" |
//                        "in_group_disabled" | "no_in_group" }

const INTERNAL_TOKEN = process.env.KAMAILIO_INBOUND_TOKEN ?? '';
const FS_INTERNAL_HOST = process.env.DIALEROS_FS_INTERNAL_HOST ?? '127.0.0.1';
const FS_INTERNAL_PORT = process.env.DIALEROS_FS_INTERNAL_PORT ?? '5080';

const BodySchema = z.object({
  to: z.string().min(2).max(40),
  from: z.string().min(2).max(40),
  call_id: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  // Token gate — Kamailio sets X-Inbound-Token; without a match
  // we 401. In dev mode (no token set in env) we accept anything
  // so a local curl can probe the endpoint, but log it.
  const presented = req.headers.get('x-inbound-token') ?? '';
  if (INTERNAL_TOKEN && presented !== INTERNAL_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!INTERNAL_TOKEN) {
    // eslint-disable-next-line no-console
    console.warn(
      '[inbound-route] KAMAILIO_INBOUND_TOKEN not set — accepting unauthenticated requests',
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { action: 'reject', reason: 'bad_request' },
      { status: 400 },
    );
  }

  const toNorm = normalizePhone(parsed.data.to);
  const fromNorm = normalizePhone(parsed.data.from);

  if (!toNorm) {
    return NextResponse.json({
      action: 'reject',
      reason: 'missing_did',
    });
  }

  // Pass 1 — iter 107 inbound whitelist. Returning callers route
  // to the in-group of the campaign that last reached them.
  if (fromNorm) {
    const match = findInboundReturnMatch(fromNorm);
    if (match && match.last_campaign_id) {
      const inGroupIds = getCampaignInGroups(match.last_campaign_id);
      // First enabled in-group on that campaign wins. iter 115
      // will support a per-campaign "callback in-group" override
      // so an outbound campaign can deliberately route returns
      // to a dedicated queue.
      for (const igId of inGroupIds) {
        const ig = getInGroup(igId);
        if (!ig || ig.enabled !== 1) continue;
        return forwardOrQueue({
          inGroupId: ig.id,
          reason: `whitelist_match:${match.status}`,
          lead_id: match.lead_id,
          to: toNorm,
          from: fromNorm,
        });
      }
    }
  }

  // Pass 2 — DID mapping.
  const inGroupId = findDidOwner(toNorm);
  if (!inGroupId) {
    return NextResponse.json({
      action: 'reject',
      reason: 'unmapped_did',
      to: toNorm,
    });
  }
  const ig = getInGroup(inGroupId);
  if (!ig) {
    return NextResponse.json({
      action: 'reject',
      reason: 'no_in_group',
      to: toNorm,
    });
  }
  if (ig.enabled !== 1) {
    return NextResponse.json({
      action: 'reject',
      reason: 'in_group_disabled',
      to: toNorm,
      in_group_id: ig.id,
    });
  }

  return forwardOrQueue({
    inGroupId: ig.id,
    reason: 'did_match',
    to: toNorm,
    from: fromNorm ?? parsed.data.from,
    call_id: parsed.data.call_id,
  });
}

interface ForwardArgs {
  inGroupId: string;
  reason: string;
  to: string;
  from: string;
  lead_id?: string;
  call_id?: string;
}

function forwardOrQueue(args: ForwardArgs): NextResponse {
  const agent = pickAvailableAgentForInGroup(args.inGroupId);
  if (!agent) {
    // No-one to route to right this second. Kamailio's dialplan
    // can park the call (mod_park) or play hold music + ringback
    // while polling — that's iter 115. For now we tell it to
    // queue so it doesn't reject the caller outright.
    appendAudit({
      actorUserId: null,
      actorIp: null,
      action: 'inbound.queued',
      targetType: 'in_group',
      targetId: args.inGroupId,
      payload: {
        from: args.from,
        to: args.to,
        reason: args.reason,
        lead_id: args.lead_id,
      },
    });
    return NextResponse.json({
      action: 'queue',
      in_group_id: args.inGroupId,
      reason: 'no_agent_available',
      classification: args.reason,
    });
  }

  appendAudit({
    actorUserId: agent.user_id,
    actorIp: null,
    action: 'inbound.forwarded',
    targetType: 'in_group',
    targetId: args.inGroupId,
    payload: {
      from: args.from,
      to: args.to,
      reason: args.reason,
      lead_id: args.lead_id,
      agent_extension: agent.extension,
    },
  });

  return NextResponse.json({
    action: 'forward',
    target_uri: `sip:${agent.extension}@${FS_INTERNAL_HOST}:${FS_INTERNAL_PORT}`,
    in_group_id: args.inGroupId,
    agent_id: agent.user_id,
    agent_extension: agent.extension,
    classification: args.reason,
  });
}
