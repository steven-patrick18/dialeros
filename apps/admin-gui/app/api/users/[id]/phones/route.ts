import { NextRequest, NextResponse } from 'next/server';
import {
  PhoneInputSchema,
  appendAudit,
  createPhone,
  getUser,
  listPhones,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 40 — list/add phones for a user.

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (me.role !== 'admin' && me.id !== id) {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  if (!getUser(id)) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  return NextResponse.json({ phones: listPhones(id) });
}

export async function POST(
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
  const target = getUser(id);
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = PhoneInputSchema.safeParse(raw);
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
  const result = createPhone(id, parsed.data);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'phone.created',
    targetType: 'user',
    targetId: id,
    payload: {
      phone_id: result.id,
      extension: parsed.data.extension,
      protocol: parsed.data.protocol,
      label: parsed.data.label ?? null,
    },
  });
  return NextResponse.json({ ok: true, id: result.id });
}
