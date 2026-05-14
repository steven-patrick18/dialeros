import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  deleteHoliday,
  setHolidayEnabled,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 180 — Single holiday: enable/disable + delete.

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin role required' },
      { status: 403 },
    );
  }
  const { id: idStr } = await ctx.params;
  const id = Number.parseInt(idStr, 10);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const obj = body as { enabled?: unknown };
  if (typeof obj.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'enabled must be boolean' },
      { status: 400 },
    );
  }
  const ok = setHolidayEnabled(id, obj.enabled);
  if (!ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'holiday.set_enabled',
    targetType: 'holiday',
    targetId: String(id),
    payload: { enabled: obj.enabled },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin role required' },
      { status: 403 },
    );
  }
  const { id: idStr } = await ctx.params;
  const id = Number.parseInt(idStr, 10);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }
  const ok = deleteHoliday(id);
  if (!ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'holiday.delete',
    targetType: 'holiday',
    targetId: String(id),
    payload: {},
  });
  return NextResponse.json({ ok: true });
}
