import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  getCampaign,
  setLeadListsForCampaign,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

// Iter 24 — atomic replace of the campaign's lead-list attachment set.
// Stealing a list from another campaign is intentional: the list's
// previous owner loses it, this campaign gains it. Audit-logged.
const Body = z.object({
  lead_list_ids: z.array(z.string().uuid()),
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
      { error: 'Provide { lead_list_ids: [uuid, ...] }.' },
      { status: 400 },
    );
  }

  let result: { detached: number; attached: number; moved: number };
  try {
    result = setLeadListsForCampaign(id, parsed.data.lead_list_ids);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'campaign.set_lead_lists',
    targetType: 'campaign',
    targetId: id,
    payload: {
      lead_list_ids: parsed.data.lead_list_ids,
      ...result,
    },
  });

  return NextResponse.json({ ok: true, ...result });
}
