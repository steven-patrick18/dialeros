import { NextRequest, NextResponse } from 'next/server';
import {
  getCampaign,
  listSurveyResponsesForExport,
} from '@dialeros/control-plane';
import { csvHeaders, csvRow } from '@/lib/csv';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 159 — Survey response CSV export.
//
// GET /api/campaigns/[id]/survey/export[?since=ISO8601]
//
// One row per survey_answer with surrounding context joined in
// (timestamp, dial_intent_id, campaign, lead phone+name, agent,
// disposition, question text+type, answer). Multi-choice answers
// stay as JSON arrays in the answer column — operators with
// pandas/sheets can split themselves; emitting one row per
// selected option would inflate the row count and complicate
// joining back to the dial_intent.
//
// Admin + supervisor read access; matches the report page.

const HEADERS = [
  'ts',
  'dial_intent_id',
  'campaign_id',
  'campaign_name',
  'lead_id',
  'lead_phone',
  'lead_name',
  'agent_username',
  'disposition',
  'question_id',
  'question_text',
  'question_type',
  'answer_text',
];

function sanitiseFilenameBit(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return NextResponse.json(
      { error: 'Admin or supervisor role required' },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  const campaign = getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const since = req.nextUrl.searchParams.get('since') || undefined;
  const rows = listSurveyResponsesForExport(id, since ?? undefined);

  // Stream-flavor: build the body in one string for the response.
  // Survey answer volumes per campaign are bounded by dial volume
  // × question count — a million-row export is highly unlikely,
  // and even at ~200 bytes/row the result fits memory comfortably.
  // Switch to a ReadableStream if a customer ever pushes past that.
  let out = csvRow(HEADERS);
  for (const r of rows) {
    out += csvRow([
      r.ts,
      r.dial_intent_id,
      r.campaign_id,
      r.campaign_name,
      r.lead_id,
      r.lead_phone,
      r.lead_name,
      r.agent_username,
      r.disposition,
      r.question_id,
      r.question_text,
      r.question_type,
      r.answer_text,
    ]);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `survey-${sanitiseFilenameBit(campaign.name)}-${stamp}.csv`;
  return new NextResponse(out, {
    headers: csvHeaders(filename),
  });
}
