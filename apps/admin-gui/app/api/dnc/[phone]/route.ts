import { NextRequest, NextResponse } from 'next/server';
import { removeDnc } from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
