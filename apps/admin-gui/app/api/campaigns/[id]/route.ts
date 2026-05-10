import { NextRequest, NextResponse } from 'next/server';
import {
  CampaignUpdateInputSchema,
  appendAudit,
  deleteCampaign,
  getCampaign,
  getCampaignLeadLists,
  updateCampaign,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const c = getCampaign(id);
  if (!c) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({
    ...c,
    lead_list_ids: getCampaignLeadLists(id),
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const existing = getCampaign(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (existing.status === 'active') {
    return NextResponse.json(
      {
        error:
          'Cannot delete an active campaign. Pause it first, then delete.',
      },
      { status: 409 },
    );
  }
  const ok = deleteCampaign(id);
  if (!ok) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'campaign.deleted',
    targetType: 'campaign',
    targetId: id,
    payload: { name: existing.name },
  });
  return NextResponse.json({ ok: true });
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const existing = getCampaign(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = CampaignUpdateInputSchema.safeParse(raw);
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
    const ok = updateCampaign(id, parsed.data);
    if (!ok) {
      return NextResponse.json({ error: 'No changes applied' }, { status: 400 });
    }
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'campaign.updated',
      targetType: 'campaign',
      targetId: id,
      payload: { name: existing.name, changes: parsed.data },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Update failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
