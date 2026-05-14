import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  countRecentCallbacksForPhone,
  dispatchQueuedCall,
  expireQueuedCall,
  expireStaleQueuedCalls,
  getCallbackDtmfDigit,
  getCallbackEnabled,
  getInGroup,
  getInboundQueuePosition,
  getQueueAnnounceEnabled,
  getQueuedCallByCallId,
  insertCallbackRequest,
  isHighestPriorityWaiter,
  pickAvailableAgentForInGroup,
} from '@dialeros/control-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 116 — FS queue-extension polling endpoint. While a caller
// is parked in FS's `dialeros-inbound-queue` extension hearing
// MOH, FS hits this every N seconds (3-5s) with the caller's
// Call-ID. We:
//   1. Look up the parked row
//   2. Pick an available agent using the same picker as inbound-
//      route (so the per-in_group routing_strategy carries
//      through to the queue path)
//   3. If picked, atomically claim the row via dispatchQueuedCall
//      and return action=forward with the agent extension. FS
//      tears down MOH and bridges.
//   4. If still no agent, return action=hold so FS keeps the
//      caller parked. Also opportunistically sweep stale rows
//      so a missed FS callback doesn't pin a row forever.
//
// Authentication: same shared-secret as /inbound-route. The
// endpoint is otherwise idempotent and safe to retry.

const INTERNAL_TOKEN = process.env.KAMAILIO_INBOUND_TOKEN ?? '';
const FS_INTERNAL_HOST = process.env.DIALEROS_FS_INTERNAL_HOST ?? '127.0.0.1';
const FS_INTERNAL_PORT = process.env.DIALEROS_FS_INTERNAL_PORT ?? '5080';

const BodySchema = z.object({
  call_id: z.string().min(1).max(200),
  // Optional reason caller hung up. When set we expire the row
  // and return action=abandoned so FS can release resources.
  hangup: z.boolean().optional(),
  // Iter 178 — DTMF captured by the FS Lua. When this is the
  // configured callback digit and callback.enabled is on, we
  // create a callback_requests row and respond callback_accepted.
  dtmf: z.string().min(1).max(1).optional(),
});

export async function POST(req: NextRequest) {
  const presented = req.headers.get('x-inbound-token') ?? '';
  if (INTERNAL_TOKEN && presented !== INTERNAL_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!INTERNAL_TOKEN) {
    // eslint-disable-next-line no-console
    console.warn(
      '[queue-poll] KAMAILIO_INBOUND_TOKEN not set — accepting unauthenticated requests',
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

  // Sweep stale rows on every poll. Cheap (single UPDATE) and
  // self-healing if FS / Kamailio ever drop a callback. The
  // default 10-minute ceiling matches the iter 117 plan for a
  // per-in_group max_wait_seconds override.
  expireStaleQueuedCalls(600);

  const row = getQueuedCallByCallId(parsed.data.call_id);

  // Iter 178 — Callback DTMF handling. When the caller pressed
  // the configured digit, capture a callback_request row and
  // tear down the queue session. We do this BEFORE the agent
  // picker so a press is honoured even when an agent just freed
  // up on the same tick.
  if (parsed.data.dtmf && row && !row.expired_at && !row.dispatched_at) {
    const enabled = getCallbackEnabled();
    const expected = getCallbackDtmfDigit();
    if (enabled && parsed.data.dtmf === expected) {
      // Abuse-protection: max 3 callback requests per phone per
      // hour. Beyond that we silently treat the press as a no-op
      // — the caller stays on hold + a future iter could speak
      // a "too many requests" prompt.
      const recent = countRecentCallbacksForPhone(row.from_phone, 1);
      if (recent < 3) {
        const cb = insertCallbackRequest({
          callId: row.call_id,
          inGroupId: row.in_group_id,
          fromPhone: row.from_phone,
          toPhone: row.to_phone,
        });
        expireQueuedCall(row.call_id, 'callback_requested');
        appendAudit({
          actorUserId: null,
          actorIp: null,
          action: 'inbound.callback_requested',
          targetType: 'in_group',
          targetId: row.in_group_id,
          payload: {
            call_id: row.call_id,
            from: row.from_phone,
            to: row.to_phone,
            callback_id: cb.id,
            dtmf: parsed.data.dtmf,
          },
        });
        return NextResponse.json({
          action: 'callback_accepted',
          callback_id: cb.id,
        });
      }
    }
  }

  // (row already declared above)

  if (!row) {
    // FS is asking about a Call-ID we don't know about. Could be
    // a stale poll after the row was expired or never enqueued.
    return NextResponse.json({
      action: 'unknown',
      reason: 'no_such_call',
    });
  }

  // Caller-side hangup signal from FS.
  if (parsed.data.hangup === true) {
    expireQueuedCall(row.call_id, 'caller_hangup');
    appendAudit({
      actorUserId: null,
      actorIp: null,
      action: 'inbound.abandoned',
      targetType: 'in_group',
      targetId: row.in_group_id,
      payload: {
        from: row.from_phone,
        to: row.to_phone,
        call_id: row.call_id,
        waited_ms: Date.now() - Date.parse(row.enqueued_at),
      },
    });
    return NextResponse.json({ action: 'abandoned' });
  }

  // Already dispatched? FS may have missed the previous response
  // and is asking again. Return the previously-resolved target.
  if (row.dispatched_at && row.dispatched_extension && !row.expired_at) {
    return NextResponse.json({
      action: 'forward',
      target_uri: `sip:${row.dispatched_extension}@${FS_INTERNAL_HOST}:${FS_INTERNAL_PORT}`,
      call_id: row.call_id,
      agent_extension: row.dispatched_extension,
      replay: true,
    });
  }
  if (row.expired_at) {
    return NextResponse.json({
      action: 'abandoned',
      reason: row.expire_reason ?? 'expired',
    });
  }

  // Try to assign. Honour the in-group's routing strategy same
  // way inbound-route does on the first pass.
  const ig = getInGroup(row.in_group_id);
  const strategy =
    ig?.routing_strategy === 'ring_all' ||
    ig?.routing_strategy === 'random' ||
    ig?.routing_strategy === 'longest_idle'
      ? ig.routing_strategy
      : 'longest_idle';
  // Iter 179 — Don't claim an agent for this caller if a
  // higher-priority caller is also waiting in the same in-group.
  // Without this, first-to-poll wins; the priority gate ensures
  // the VIP band gets served first when an agent comes free.
  if (!isHighestPriorityWaiter(row.call_id)) {
    return NextResponse.json({
      action: 'hold',
      reason: 'priority_yield',
      waited_ms: Date.now() - Date.parse(row.enqueued_at),
      announce: getQueueAnnounceEnabled(),
      callback_enabled: getCallbackEnabled(),
      callback_dtmf: getCallbackDtmfDigit(),
    });
  }

  const agent = pickAvailableAgentForInGroup(row.in_group_id, strategy);
  if (!agent) {
    // Iter 177 — position + ETA + announce flag.
    // Iter 178 — callback_enabled + callback_dtmf so the FS Lua
    // knows whether/which DTMF to listen for.
    const pos = getInboundQueuePosition(row.call_id);
    return NextResponse.json({
      action: 'hold',
      reason: 'no_agent_yet',
      waited_ms: Date.now() - Date.parse(row.enqueued_at),
      announce: getQueueAnnounceEnabled(),
      position: pos?.position ?? null,
      ahead: pos?.ahead ?? null,
      eta_seconds: pos?.eta_seconds ?? null,
      callback_enabled: getCallbackEnabled(),
      callback_dtmf: getCallbackDtmfDigit(),
    });
  }

  // Atomic claim — only succeeds when the row is still pending.
  // Race-safe against two FS workers polling for the same caller.
  const claimed = dispatchQueuedCall(
    row.call_id,
    agent.user_id,
    agent.extension,
  );
  if (!claimed) {
    // Lost the race; re-read and respond with whatever stuck.
    const after = getQueuedCallByCallId(row.call_id);
    if (after?.dispatched_extension) {
      return NextResponse.json({
        action: 'forward',
        target_uri: `sip:${after.dispatched_extension}@${FS_INTERNAL_HOST}:${FS_INTERNAL_PORT}`,
        call_id: after.call_id,
        agent_extension: after.dispatched_extension,
        replay: true,
      });
    }
    // Iter 177/178 — same enrichment.
    const pos = getInboundQueuePosition(row.call_id);
    return NextResponse.json({
      action: 'hold',
      reason: 'lost_race',
      announce: getQueueAnnounceEnabled(),
      position: pos?.position ?? null,
      ahead: pos?.ahead ?? null,
      eta_seconds: pos?.eta_seconds ?? null,
      callback_enabled: getCallbackEnabled(),
      callback_dtmf: getCallbackDtmfDigit(),
    });
  }

  appendAudit({
    actorUserId: agent.user_id,
    actorIp: null,
    action: 'inbound.dispatched_from_queue',
    targetType: 'in_group',
    targetId: row.in_group_id,
    payload: {
      from: row.from_phone,
      to: row.to_phone,
      call_id: row.call_id,
      agent_extension: agent.extension,
      waited_ms: Date.now() - Date.parse(row.enqueued_at),
    },
  });

  return NextResponse.json({
    action: 'forward',
    target_uri: `sip:${agent.extension}@${FS_INTERNAL_HOST}:${FS_INTERNAL_PORT}`,
    call_id: row.call_id,
    agent_extension: agent.extension,
    waited_ms: Date.now() - Date.parse(row.enqueued_at),
  });
}
