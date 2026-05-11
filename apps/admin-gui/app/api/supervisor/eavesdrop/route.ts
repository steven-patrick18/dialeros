import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  extensionForUser,
  getDialIntentById,
  getPrimaryPhone,
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

const Body = z.object({
  intent_id: z.number().int().positive(),
  mode: z.enum(['monitor', 'whisper', 'barge']),
});

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return NextResponse.json(
      { error: 'Admin or supervisor role required' },
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

  const intent = getDialIntentById(parsed.data.intent_id);
  if (!intent) {
    return NextResponse.json({ error: 'Intent not found' }, { status: 404 });
  }
  if (!intent.call_uuid || !intent.answered_at || intent.hangup_at) {
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
      payload: { mode: parsed.data.mode, target_uuid: intent.call_uuid },
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
