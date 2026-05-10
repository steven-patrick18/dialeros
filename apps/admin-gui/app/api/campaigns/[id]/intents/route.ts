import { NextRequest, NextResponse } from 'next/server';
import {
  getActiveAgentsForCampaign,
  getCampaign,
  getUser,
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

  const intents = listIntentsForCampaign(id, limit);
  // Resolve usernames for assigned_user_ids in one pass (cache by id).
  const userCache = new Map<string, string>();
  const enriched = intents.map((i) => {
    let assigned_username: string | null = null;
    if (i.assigned_user_id) {
      assigned_username =
        userCache.get(i.assigned_user_id) ??
        getUser(i.assigned_user_id)?.username ??
        null;
      if (assigned_username) userCache.set(i.assigned_user_id, assigned_username);
    }
    return { ...i, assigned_username };
  });

  return NextResponse.json({
    pacing: isPacing(id),
    total: totalIntentsFor(id),
    attached_agents: getActiveAgentsForCampaign(id).length,
    intents: enriched,
  });
}
