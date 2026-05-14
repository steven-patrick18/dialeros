import { NextResponse } from 'next/server';
import { listCallbackRequests } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 178 — Supervisor listing. Returns all callbacks pending
// first (FIFO) then recent resolved tail.

export async function GET() {
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
  // Plain-object cast to dodge node:sqlite null-prototype rows.
  const rows = JSON.parse(
    JSON.stringify(listCallbackRequests('', 200)),
  ) as ReturnType<typeof listCallbackRequests>;
  return NextResponse.json({ rows });
}
