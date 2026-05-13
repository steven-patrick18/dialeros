import { NextRequest, NextResponse } from 'next/server';
import {
  CallMenuInputSchema,
  appendAudit,
  deleteCallMenu,
  getCallMenu,
  getCallMenuOptions,
  updateCallMenu,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 149 — GET / PUT / DELETE single call menu.
// GET returns menu + its options in one payload. PUT replaces the
// whole definition including the option list (delete-and-insert
// inside a transaction). DELETE removes the menu and cascades to
// its options via FK ON DELETE CASCADE.

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const menu = getCallMenu(id);
  if (!menu) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({
    menu,
    options: getCallMenuOptions(id),
  });
}

export async function PUT(
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
  const { id } = await ctx.params;
  if (!getCallMenu(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = CallMenuInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const result = await updateCallMenu(id, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'call_menu.update',
      targetType: 'call_menu',
      targetId: id,
      payload: { options: parsed.data.options.length },
    });
    return NextResponse.json({ ok: true, deploy: result.deploy });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
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
  const { id } = await ctx.params;
  const result = await deleteCallMenu(id);
  if (!result.ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'call_menu.delete',
    targetType: 'call_menu',
    targetId: id,
    payload: {},
  });
  return NextResponse.json({ ok: true, deploy: result.deploy });
}
