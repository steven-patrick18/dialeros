import { NextResponse } from 'next/server';
import {
  getAiLiveEnabled,
  listAiCallSessions,
  summarizeAbResults,
  userHasPermission,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 195 — AI call sessions list + the live-enable flag for
// the review page header. Gated on ai.manage (admin implicit).

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json(
      { error: 'ai.manage permission required' },
      { status: 403 },
    );
  }
  const sessions = listAiCallSessions(200);
  const ab_summary = summarizeAbResults(
    sessions.map((s) => ({
      persona_id: s.persona_id,
      status: s.status,
      turn_count: s.turn_count,
      qa_score: s.qa_score,
    })),
  );
  return NextResponse.json({
    live_enabled: getAiLiveEnabled(),
    sessions: JSON.parse(JSON.stringify(sessions)),
    ab_summary,
  });
}
