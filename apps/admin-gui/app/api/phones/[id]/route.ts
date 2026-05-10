import { NextRequest, NextResponse } from 'next/server';
import {
  PhoneUpdateInputSchema,
  appendAudit,
  getPhone,
  removePhone,
  updatePhone,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 40 — edit / delete a single phone.

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const existing = getPhone(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = PhoneUpdateInputSchema.safeParse(raw);
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
  const result = updatePhone(id, parsed.data);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  const auditPayload: Record<string, unknown> = {
    phone_id: id,
    user_id: existing.user_id,
  };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (k === 'password') {
      if (v) auditPayload.password_changed = true;
      continue;
    }
    if (v !== undefined) auditPayload[k] = v;
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'phone.updated',
    targetType: 'user',
    targetId: existing.user_id,
    payload: auditPayload,
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
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const existing = getPhone(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const result = removePhone(id);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'phone.deleted',
    targetType: 'user',
    targetId: existing.user_id,
    payload: {
      phone_id: id,
      extension: existing.extension,
    },
  });
  return NextResponse.json({ ok: result.ok });
}
