import { NextRequest, NextResponse } from 'next/server';
import {
  addDidToInGroup,
  appendAudit,
  getInGroup,
  removeDidFromInGroup,
  setDidPriority,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
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
  if (!getInGroup(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const raw = (await req.json().catch(() => ({}))) as { did?: unknown };
  if (typeof raw.did !== 'string' || raw.did.trim().length === 0) {
    return NextResponse.json({ error: 'did is required' }, { status: 400 });
  }

  const result = addDidToInGroup(id, raw.did);
  if (!result.ok) {
    if (result.error === 'invalid_format') {
      return NextResponse.json(
        { error: `Invalid phone number: ${raw.did}` },
        { status: 400 },
      );
    }
    if (result.error === 'already_attached') {
      const sameGroup = result.existingOwner === id;
      return NextResponse.json(
        {
          error: sameGroup
            ? 'DID is already attached to this in-group.'
            : 'DID is attached to a different in-group. Detach it there first.',
        },
        { status: 409 },
      );
    }
  } else {
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'in_group.did_added',
      targetType: 'in_group',
      targetId: id,
      payload: { did: result.did },
    });
    return NextResponse.json({ ok: true, did: result.did }, { status: 201 });
  }
  return NextResponse.json({ error: 'unknown' }, { status: 500 });
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
  if (!getInGroup(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const url = new URL(req.url);
  const did = url.searchParams.get('did');
  if (!did) {
    return NextResponse.json(
      { error: 'did query parameter required' },
      { status: 400 },
    );
  }
  const removed = removeDidFromInGroup(id, did);
  if (!removed) {
    return NextResponse.json({ error: 'DID not attached' }, { status: 404 });
  }
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'in_group.did_removed',
    targetType: 'in_group',
    targetId: id,
    payload: { did },
  });
  return NextResponse.json({ ok: true });
}

// Iter 179 — Update a DID's priority band (0..9, 0=highest).
export async function PATCH(
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
  if (!getInGroup(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const raw = (await req.json().catch(() => ({}))) as {
    did?: unknown;
    priority?: unknown;
  };
  if (typeof raw.did !== 'string' || raw.did.trim().length === 0) {
    return NextResponse.json({ error: 'did is required' }, { status: 400 });
  }
  if (
    typeof raw.priority !== 'number' ||
    !Number.isInteger(raw.priority) ||
    raw.priority < 0 ||
    raw.priority > 9
  ) {
    return NextResponse.json(
      { error: 'priority must be integer 0..9' },
      { status: 400 },
    );
  }
  const ok = setDidPriority(raw.did, raw.priority);
  if (!ok) {
    return NextResponse.json(
      { error: 'DID not found' },
      { status: 404 },
    );
  }
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'in_group.did_priority',
    targetType: 'in_group',
    targetId: id,
    payload: { did: raw.did, priority: raw.priority },
  });
  return NextResponse.json({ ok: true });
}
