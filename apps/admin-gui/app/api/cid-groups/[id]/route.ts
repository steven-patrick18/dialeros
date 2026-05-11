import { NextRequest, NextResponse } from 'next/server';
import {
  CidGroupUpdateInputSchema,
  appendAudit,
  countCidsInGroup,
  deleteCidGroup,
  getCidGroup,
  listCidsInGroup,
  listRoutePlansUsingCidGroup,
  updateCidGroup,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const group = getCidGroup(id);
  if (!group) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({
    id: group.id,
    name: group.name,
    description: group.description,
    strategy: group.strategy,
    cid_count: countCidsInGroup(group.id),
    numbers: listCidsInGroup(group.id).map((n) => ({
      id: n.id,
      number: n.number,
      created_at: n.created_at,
    })),
    used_by: listRoutePlansUsingCidGroup(group.id).map((p) => ({
      id: p.id,
      name: p.name,
    })),
    created_at: group.created_at,
    updated_at: group.updated_at,
  });
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const raw = await req.json().catch(() => ({}));
  const parsed = CidGroupUpdateInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
          .join('; '),
      },
      { status: 400 },
    );
  }
  try {
    const ok = updateCidGroup(id, parsed.data);
    if (!ok) {
      return NextResponse.json(
        { error: 'No changes' },
        { status: 200 },
      );
    }
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'cid_group.updated',
      targetType: 'cid_group',
      targetId: id,
      payload: parsed.data,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Failed to update CID group';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    const removed = deleteCidGroup(id);
    if (!removed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'cid_group.deleted',
      targetType: 'cid_group',
      targetId: id,
      payload: {},
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Failed to delete CID group';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
