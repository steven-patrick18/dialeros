import { NextRequest, NextResponse } from 'next/server';
import {
  getCampaign,
  isPacing,
  listIntentsForCampaign,
  totalIntentsFor,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!getCampaign(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const url = new URL(req.url);
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get('limit') ?? 100)),
  );
  return NextResponse.json({
    pacing: isPacing(id),
    total: totalIntentsFor(id),
    intents: listIntentsForCampaign(id, limit),
  });
}
