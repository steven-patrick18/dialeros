import { NextRequest, NextResponse } from 'next/server';
import {
  aiSessionMonitorState,
  appendAudit,
  endAiCallSession,
  extensionForUser,
  getAiCallSession,
  getPrimaryPhone,
  userHasPermission,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';
import { eslApi } from '@/lib/esl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 196 — Barge-to-human: yank the caller off the AI onto a
// live human (the supervisor's own registered softphone, per
// the iter-193 browser-WebRTC choice). uuid_transfer the AI
// call leg out of the dialeros-ai-agent park and inline-bridge
// it to the supervisor. The media-bridge daemon's WS closes
// when the channel transfers → it posts session end; we ALSO
// end it here defensively with status=seized so the review page
// shows why. Seizing is a barge-class action → monitor.barge.

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'monitor.barge')) {
    return NextResponse.json(
      { error: 'monitor.barge permission required' },
      { status: 403 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    session_id?: unknown;
  };
  const sid = String(body.session_id ?? '');
  if (!sid) {
    return NextResponse.json(
      { error: 'session_id required' },
      { status: 400 },
    );
  }
  const session = getAiCallSession(sid);
  if (!session) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }
  const st = aiSessionMonitorState(session);
  if (!st.seizable) {
    return NextResponse.json(
      { error: `not seizable: ${st.reason}` },
      { status: 409 },
    );
  }
  const primary = getPrimaryPhone(me.id);
  const supExt = primary?.extension ?? extensionForUser(me.id);
  // Transfer the caller leg out of the AI park, inline-bridging
  // it to the supervisor. 'inline' dialplan runs the bridge app
  // immediately without a context lookup.
  const cmd = `uuid_transfer ${session.call_uuid} 'bridge:user/${supExt}' inline`;
  try {
    const reply = (await eslApi(cmd)).trim();
    if (!reply.startsWith('+OK')) {
      return NextResponse.json(
        { error: reply || 'transfer failed' },
        { status: 502 },
      );
    }
    endAiCallSession(sid, `seized_by:${me.username}`, 'seized');
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'supervisor.ai_seize',
      targetType: 'ai_call_session',
      targetId: sid,
      payload: {
        target_uuid: session.call_uuid,
        persona_id: session.persona_id,
        to_ext: supExt,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: (e as { message?: string }).message ?? 'transfer failed' },
      { status: 502 },
    );
  }
}
