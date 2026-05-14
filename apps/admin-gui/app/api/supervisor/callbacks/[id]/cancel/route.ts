import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  cancelCallback,
  getCallbackRequestById,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 178 — Cancel a pending or dispatched callback request.
// Supervisor / admin only.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
  const { id: idStr } = await params;
  const id = Number.parseInt(idStr, 10);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }
  const existing = getCallbackRequestById(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const ok = cancelCallback(id, me.id, 'supervisor_cancelled');
  if (!ok) {
    return NextResponse.json(
      { error: 'Row not in cancellable state' },
      { status: 409 },
    );
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'inbound.callback_cancelled',
    targetType: 'callback_request',
    targetId: String(id),
    payload: { from_phone: existing.from_phone },
  });
  return NextResponse.json({ ok: true });
}
