import { NextResponse } from 'next/server';
import { listActiveCalls } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  return NextResponse.json({ calls: listActiveCalls() });
}
