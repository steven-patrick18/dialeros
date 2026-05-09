import { NextRequest, NextResponse } from 'next/server';
import {
  CampaignInputSchema,
  appendAudit,
  createCampaign,
  getCampaignLeadLists,
  listCampaigns,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const campaigns = listCampaigns().map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    type: c.type,
    status: c.status,
    route_plan_id: c.route_plan_id,
    lead_list_ids: getCampaignLeadLists(c.id),
    base_ratio: c.base_ratio,
    created_at: c.created_at,
  }));
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = CampaignInputSchema.safeParse(raw);
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

  try {
    const result = createCampaign(parsed.data);
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'campaign.created',
      targetType: 'campaign',
      targetId: result.id,
      payload: {
        name: parsed.data.name,
        type: parsed.data.type,
        route_plan_id: parsed.data.route_plan_id,
        lead_lists_count: parsed.data.lead_list_ids.length,
      },
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Failed to create campaign';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
