import { NextRequest, NextResponse } from 'next/server';
import {
  SurveyInputSchema,
  appendAudit,
  deleteCampaignSurvey,
  getCampaign,
  getCampaignSurvey,
  parseSurveyOptions,
  saveCampaignSurvey,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 157 — Per-campaign survey CRUD.
// GET    /api/campaigns/[id]/survey  — survey + questions (or null)
// PUT    /api/campaigns/[id]/survey  — admin only, replace-all
// DELETE /api/campaigns/[id]/survey  — admin only, drop the survey
//
// Single-survey-per-campaign so the agent wrap-up (iter 158)
// doesn't have to disambiguate. iter 159's reporting can extend
// to multiple-surveys later if A/B testing becomes a real ask.

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
  const data = getCampaignSurvey(id);
  if (!data) {
    return NextResponse.json({ survey: null, questions: [] });
  }
  return NextResponse.json({
    survey: data.survey,
    // Surface parsed options inline so the client UI doesn't have
    // to re-implement options_json parsing for every question.
    questions: data.questions.map((q) => ({
      ...q,
      options: parseSurveyOptions(q),
    })),
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
  const parsed = SurveyInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const result = saveCampaignSurvey(id, parsed.data);
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'campaign_survey.save',
      targetType: 'campaign',
      targetId: id,
      payload: {
        survey_id: result.id,
        name: parsed.data.name,
        is_active: parsed.data.is_active,
        questions: parsed.data.questions.length,
      },
    });
    return NextResponse.json({ ok: true, id: result.id });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}

export async function DELETE(
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
  const ok = deleteCampaignSurvey(id);
  if (!ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'campaign_survey.delete',
    targetType: 'campaign',
    targetId: id,
    payload: {},
  });
  return NextResponse.json({ ok: true });
}
