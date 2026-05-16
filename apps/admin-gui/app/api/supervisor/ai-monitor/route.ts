import { NextRequest, NextResponse } from 'next/server';
import {
  aiSessionMonitorState,
  appendAudit,
  extensionForUser,
  getAiCallSession,
  getPrimaryPhone,
  userHasPermission,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';
import { eslApi } from '@/lib/esl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 196 — Listen in on a live AI call. Same originate +
// eavesdrop pattern as the iter-65/193 agent monitor, but the
// target uuid comes from ai_call_sessions (the AI call has no
// human agent). Listen-only: the supervisor hears the caller +
// the AI's TTS. monitor.listen gated.

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'monitor.listen')) {
    return NextResponse.json(
      { error: 'monitor.listen permission required' },
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
  if (!st.monitorable) {
    return NextResponse.json(
      { error: `not monitorable: ${st.reason}` },
      { status: 409 },
    );
  }
  const primary = getPrimaryPhone(me.id);
  const supExt = primary?.extension ?? extensionForUser(me.id);
  const cmd = `originate user/${supExt} &eavesdrop(${session.call_uuid})`;
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
      action: 'supervisor.ai_monitor',
      targetType: 'ai_call_session',
      targetId: sid,
      payload: { target_uuid: session.call_uuid, persona_id: session.persona_id },
    });
    return NextResponse.json({ ok: true, uuid: reply.slice(4).trim() });
  } catch (e) {
    return NextResponse.json(
      { error: (e as { message?: string }).message ?? 'originate failed' },
      { status: 502 },
    );
  }
}
