import { NextRequest, NextResponse } from 'next/server';
import {
  getAiCallSession,
  listAiCallTurns,
  userHasPermission,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 195 — one session's transcript + per-turn latency.

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json(
      { error: 'ai.manage permission required' },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  const session = getAiCallSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({
    session: JSON.parse(JSON.stringify(session)),
    turns: JSON.parse(JSON.stringify(listAiCallTurns(id))),
  });
}
