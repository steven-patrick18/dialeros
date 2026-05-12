import { NextRequest, NextResponse } from 'next/server';
import { lookupDnc, removeDnc } from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 106 — DNC status lookup. Normalises the inbound phone the
// same way insert/check do, so an operator can paste any format
// and get a yes/no plus reason / added_at / added_by. Returns 200
// with { listed: false } when the number is clean — we want this
// to be a successful health-check call, not a 404, so the manager
// UI can render either state without try/catch noise.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ phone: string }> },
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
  const { phone } = await ctx.params;
  const rec = lookupDnc(decodeURIComponent(phone));
  if (!rec) {
    return NextResponse.json({ listed: false });
  }
  return NextResponse.json({
    listed: true,
    phone: rec.phone,
    reason: rec.reason,
    added_at: rec.added_at,
    added_by_user_id: rec.added_by_user_id,
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ phone: string }> },
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
  const { phone } = await ctx.params;
  const ok = removeDnc(decodeURIComponent(phone), {
    actorUserId: me.id,
    actorIp: clientIp(req),
  });
  if (!ok) {
    return NextResponse.json(
      { error: 'Phone not on the DNC list' },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok });
}
