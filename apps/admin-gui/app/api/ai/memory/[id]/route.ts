import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  deleteAiMemory,
  getAiMemory,
  setAiMemoryEnabled,
  userHasPermission,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json({ error: 'ai.manage required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!getAiMemory(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const b = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof b.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'enabled must be boolean' },
      { status: 400 },
    );
  }
  setAiMemoryEnabled(id, b.enabled);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'ai.memory_toggled',
    targetType: 'ai_memory',
    targetId: id,
    payload: { enabled: b.enabled },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json({ error: 'ai.manage required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!deleteAiMemory(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'ai.memory_deleted',
    targetType: 'ai_memory',
    targetId: id,
    payload: {},
  });
  return NextResponse.json({ ok: true });
}
