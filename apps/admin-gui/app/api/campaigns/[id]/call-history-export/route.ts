import { NextRequest, NextResponse } from 'next/server';
import {
  getCampaign,
  listCampaignCallHistoryForExport,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { csvHeaders, csvRow } from '@/lib/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 126 — CSV export of campaign call history. One row per
// non-simulated dial_intent, joined with the lead's phone/name +
// the carrier name so the file is self-contained (no FK
// resolution needed at the spreadsheet end). Admin / supervisor
// only.
//
// Query params:
//   since=<ISO 8601>   — optional. Clamp to "calls since this
//                        timestamp". Useful for "yesterday only"
//                        or "last week" exports.

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
    return NextResponse.json(
      { error: 'Campaign not found' },
      { status: 404 },
    );
  }

  const since = req.nextUrl.searchParams.get('since');
  // Loose validation — Date.parse accepts a wide range of ISO
  // variants. A bad value produces NaN, which we reject up-front
  // so we don't slip a malformed string into the SQL bind.
  if (since && Number.isNaN(Date.parse(since))) {
    return NextResponse.json(
      { error: 'Invalid `since` ISO timestamp.' },
      { status: 400 },
    );
  }

  const rows = listCampaignCallHistoryForExport(id, since);

  const safeName = campaign.name.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${safeName}-calls-${stamp}.csv`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Header — matches CampaignCallHistoryRow fields exactly so a
      // future CSV→DB import round-trips cleanly.
      controller.enqueue(
        encoder.encode(
          csvRow([
            'id',
            'ts',
            'lead_id',
            'lead_phone',
            'lead_name',
            'transformed_phone',
            'cid_used',
            'kind',
            'assigned_user_id',
            'carrier_id',
            'carrier_name',
            'answered_at',
            'hangup_at',
            'hangup_cause',
            'duration_ms',
            'disposition',
            'dispositioned_at',
            'amd_result',
            'recording_path',
            'originate_error',
          ]),
        ),
      );

      for (const r of rows) {
        controller.enqueue(
          encoder.encode(
            csvRow([
              r.id,
              r.ts,
              r.lead_id,
              r.lead_phone,
              r.lead_name,
              r.transformed_phone,
              r.cid_used,
              r.kind,
              r.assigned_user_id,
              r.carrier_id,
              r.carrier_name,
              r.answered_at,
              r.hangup_at,
              r.hangup_cause,
              r.duration_ms,
              r.disposition,
              r.dispositioned_at,
              r.amd_result,
              r.recording_path,
              r.originate_error,
            ]),
          ),
        );
      }

      controller.close();
    },
  });

  return new Response(stream, { headers: csvHeaders(filename) });
}
