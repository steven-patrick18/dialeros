import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { appendAudit, getLeadList, moveLeadList } from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

// Iter 23 — move (or detach) a lead list. Body shape:
//   { campaign_id: "<uuid>" }   move to that campaign (steals from any
//                               campaign currently holding it)
//   { campaign_id: null }       detach — list belongs to no campaign
const Body = z.object({
  campaign_id: z.string().uuid().nullable(),
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
  if (!getLeadList(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Provide { campaign_id: "<uuid>" } or { campaign_id: null }.',
      },
      { status: 400 },
    );
  }

  try {
    const ok = moveLeadList(id, parsed.data.campaign_id);
    if (!ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'lead_list.move',
    targetType: 'lead_list',
    targetId: id,
    payload: { campaign_id: parsed.data.campaign_id },
  });

  return NextResponse.json({ ok: true });
}
