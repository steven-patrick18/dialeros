import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  getCampaign,
  setCampaignInGroupAttachment,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

// Iter 24 — atomic replace of the campaign's in-group attachment set.
// Body: { in_group_ids: ["uuid", ...] }
const Body = z.object({
  in_group_ids: z.array(z.string().uuid()),
});

export async function POST(
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

  const raw = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Provide { in_group_ids: [uuid, ...] }.' },
      { status: 400 },
    );
  }

  try {
    setCampaignInGroupAttachment(id, parsed.data.in_group_ids);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'campaign.set_in_groups',
    targetType: 'campaign',
    targetId: id,
    payload: {
      in_group_ids: parsed.data.in_group_ids,
      count: parsed.data.in_group_ids.length,
    },
  });

  return NextResponse.json({ ok: true });
}
