import { NextResponse } from 'next/server';
import {
  liveAgentSnapshot,
  userHasPermission,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 193 — ViciDial-style agent roster for the supervisor
// board. Every active agent + their live state (AVAILABLE /
// PAUSED / on a call). Lets a supervisor watch a PAUSED agent
// and one-click monitor the instant their next call connects.
// Gated on monitor.listen (admin implicit via userHasPermission;
// the supervisor role default grants it from iter 192).

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!userHasPermission(me, 'monitor.listen')) {
    return NextResponse.json(
      { error: 'monitor.listen permission required' },
      { status: 403 },
    );
  }
  return NextResponse.json({
    agents: JSON.parse(JSON.stringify(liveAgentSnapshot())),
  });
}
