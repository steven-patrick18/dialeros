import { NextRequest, NextResponse } from 'next/server';
import { getCarrier } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { gatewayStatusFor } from '@/lib/freeswitch-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const carrier = getCarrier(id);
  if (!carrier) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const status = await gatewayStatusFor({ id });
  return NextResponse.json(status);
}
