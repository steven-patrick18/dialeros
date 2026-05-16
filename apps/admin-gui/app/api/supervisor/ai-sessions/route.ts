import { NextResponse } from 'next/server';
import {
  aiSessionMonitorState,
  listAiCallSessions,
  listAiCallTurns,
  userHasPermission,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 196 — live AI sessions for the supervisor board. Active
// sessions only, each with its last few turns so the supervisor
// sees the conversation as it happens. Gated on monitor.listen.

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'monitor.listen')) {
    return NextResponse.json(
      { error: 'monitor.listen permission required' },
      { status: 403 },
    );
  }
  const active = listAiCallSessions(200).filter(
    (s) => s.status === 'active' && s.ended_at == null,
  );
  const sessions = active.map((s) => {
    const turns = listAiCallTurns(s.id);
    return {
      ...s,
      state: aiSessionMonitorState(s),
      last_turns: turns.slice(-6).map((t) => ({
        role: t.role,
        text: t.text,
        turn_index: t.turn_index,
      })),
    };
  });
  return NextResponse.json({
    sessions: JSON.parse(JSON.stringify(sessions)),
  });
}
