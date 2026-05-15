import { NextResponse } from 'next/server';
import { gatherAllNodeLoad, userHasPermission } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 191 — Real-time cluster load. Admin + supervisor. Each
// node probed in parallel with a 4s per-node timeout so one dead
// box never stalls the response. Polled by the /cluster/load
// page every 5s.

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (
    me.role !== 'admin' &&
    me.role !== 'supervisor' &&
    !userHasPermission(me, 'cluster.view')
  ) {
    return NextResponse.json(
      { error: 'cluster.view permission required' },
      { status: 403 },
    );
  }
  const snapshots = await gatherAllNodeLoad(4000);
  return NextResponse.json({
    ts: new Date().toISOString(),
    nodes: JSON.parse(JSON.stringify(snapshots)),
  });
}
