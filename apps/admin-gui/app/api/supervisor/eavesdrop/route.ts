import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  extensionForUser,
  getDialIntentById,
  getPrimaryPhone,
  liveAgentSnapshot,
  userHasPermission,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';
import { eslApi } from '@/lib/esl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 65 — supervisor monitor / whisper / barge.
//
// Originates an INVITE to the supervisor's softphone; on answer the
// supervisor's channel runs FreeSWITCH's eavesdrop app against the
// target dial_intent's call_uuid. Eavesdrop mode is controlled by
// channel vars set BEFORE eavesdrop runs on the supervisor's leg:
//
//   monitor  — listen only (default; agent + customer hear nothing)
//   whisper  — supervisor talks; only the agent hears (a-leg)
//   barge    — full 3-way; supervisor on the bridge with both legs

const Body = z
  .object({
    // Iter 193 — either target a specific call (legacy, call-
    // centric) OR an agent (ViciDial-style: monitor whoever
    // they're talking to right now; resolves to their current
    // live intent).
    intent_id: z.number().int().positive().optional(),
    agent_user_id: z.string().min(1).optional(),
    mode: z.enum(['monitor', 'whisper', 'barge']),
  })
  .refine((b) => b.intent_id != null || b.agent_user_id != null, {
    message: 'intent_id or agent_user_id required',
  });

// Iter 193 — per-mode permission. Supervisors keep working
// (role default grants all three from iter 192); a non-
// supervisor can now be granted listen-only without whisper/
// barge. Admin implicit via userHasPermission.
const MODE_PERMISSION = {
  monitor: 'monitor.listen',
  whisper: 'monitor.whisper',
  barge: 'monitor.barge',
} as const;

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

  // Per-mode permission gate (iter 192 slugs). Admin implicit.
  const perm = MODE_PERMISSION[parsed.data.mode];
  if (!userHasPermission(me, perm)) {
    return NextResponse.json(
      { error: `${perm} permission required` },
      { status: 403 },
    );
  }

  // Resolve the target intent. Agent-centric: look up the agent's
  // current live call from the snapshot. If the agent is paused /
  // idle (no live intent), return a structured 409 so the board
  // can say 'no live call to monitor yet' rather than erroring
  // opaquely — the supervisor watches the roster + the button
  // auto-arms when the agent's call connects (2s poll).
  let intentId = parsed.data.intent_id ?? null;
  if (parsed.data.agent_user_id) {
    const row = liveAgentSnapshot().find(
      (r) => r.user_id === parsed.data.agent_user_id,
    );
    if (!row) {
      return NextResponse.json(
        { error: 'agent_not_found' },
        { status: 404 },
      );
    }
    if (!row.call_intent_id) {
      return NextResponse.json(
        {
          error: 'agent_has_no_live_call',
          agent_state: row.status,
          pause_reason: row.pause_reason ?? null,
        },
        { status: 409 },
      );
    }
    intentId = row.call_intent_id;
  }

  if (intentId == null) {
    return NextResponse.json(
      { error: 'no target resolved' },
      { status: 400 },
    );
  }

  const intent = getDialIntentById(intentId);
  if (!intent) {
    return NextResponse.json({ error: 'Intent not found' }, { status: 404 });
  }
  // Iter 193 — relaxed liveness: require a live channel
  // (call_uuid present, not hung up). answered_at may be null for
  // a call caught while still ringing — eavesdrop attaches to the
  // channel either way.
  if (!intent.call_uuid || intent.hangup_at) {
    return NextResponse.json(
      { error: 'Call is no longer live.' },
      { status: 409 },
    );
  }

  const primary = getPrimaryPhone(me.id);
  const supExt = primary?.extension ?? extensionForUser(me.id);

  // Channel vars on the supervisor's leg. FS reads these when
  // eavesdrop attaches to the target.
  const chanVars: string[] = [];
  if (parsed.data.mode === 'whisper') {
    // Agent-leg whisper only. Customer doesn't hear the supervisor.
    chanVars.push('eavesdrop_whisper_aleg=true');
  } else if (parsed.data.mode === 'barge') {
    chanVars.push('eavesdrop_bridge_aleg=true');
    chanVars.push('eavesdrop_bridge_bleg=true');
  }
  // monitor mode = no extra vars (eavesdrop default = silent listen)

  const vars = chanVars.length > 0 ? `{${chanVars.join(',')}}` : '';
  const cmd = `originate ${vars}user/${supExt} &eavesdrop(${intent.call_uuid})`;

  try {
    const reply = (await eslApi(cmd)).trim();
    if (!reply.startsWith('+OK ')) {
      return NextResponse.json(
        { error: reply || 'originate failed' },
        { status: 502 },
      );
    }
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'supervisor.eavesdrop',
      targetType: 'dial_intent',
      targetId: String(intent.id),
      payload: {
        mode: parsed.data.mode,
        target_uuid: intent.call_uuid,
        via: parsed.data.agent_user_id ? 'agent' : 'intent',
        agent_user_id: parsed.data.agent_user_id ?? null,
      },
    });
    return NextResponse.json({
      ok: true,
      mode: parsed.data.mode,
      uuid: reply.slice(4).trim(),
    });
  } catch (e) {
    const err = e as { message?: string };
    return NextResponse.json(
      { error: err.message ?? 'originate failed' },
      { status: 502 },
    );
  }
}
