import { NextRequest, NextResponse } from 'next/server';
import {
  CampaignSkillsInputSchema,
  appendAudit,
  getCampaign,
  getCampaignRequiredSkills,
  saveCampaignRequiredSkills,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 175 — Per-campaign required skills.

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!getCampaign(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({
    required_skills: getCampaignRequiredSkills(id),
  });
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin role required' },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  if (!getCampaign(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const skillsField =
    (body as { skills?: unknown; required_skills?: unknown })?.skills ??
    (body as { required_skills?: unknown })?.required_skills ??
    body;
  const parsed = CampaignSkillsInputSchema.safeParse(skillsField);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const result = saveCampaignRequiredSkills(id, parsed.data);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'campaign_skills.saved',
    targetType: 'campaign',
    targetId: id,
    payload: { count: result.count, required_skills: parsed.data },
  });
  return NextResponse.json({
    ok: true,
    count: result.count,
    required_skills: getCampaignRequiredSkills(id),
  });
}
