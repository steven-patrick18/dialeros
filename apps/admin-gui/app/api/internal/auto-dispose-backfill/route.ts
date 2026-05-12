import { NextRequest, NextResponse } from 'next/server';
import {
  applyAutoDisposition,
  inferAutoDisposition,
  getCampaignFromDb,
  listAutoDispositionCandidates,
  type AutoDispoCampaign,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 146 — backfill auto-dispositions for historical rows.
// inferAutoDisposition runs at CHANNEL_HANGUP_COMPLETE for new
// calls, but every row in the database from before iter 146 has
// disposition=NULL. This endpoint walks those rows once and tags
// them so reports stop showing a wall of "—".
//
// Auth: admin session OR X-Inbound-Token (consistent with the
// other internal endpoints). Supports ?dry_run=1 to preview
// without writing. Default limit 5000 rows per call so an
// operator with hundreds of thousands of rows can run it in
// chunks (the endpoint walks oldest-first and skips already-
// dispositioned rows, so subsequent runs naturally advance).

async function authorized(req: NextRequest): Promise<boolean> {
  const expected = process.env.KAMAILIO_INBOUND_TOKEN;
  if (expected) {
    const header = req.headers.get('x-inbound-token');
    if (header && header === expected) return true;
  }
  const me = await getCurrentUser();
  return Boolean(me && me.role === 'admin');
}

function clampLimit(raw: string | null): number {
  if (!raw) return 5000;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 5000;
  return Math.max(1, Math.min(50000, Math.floor(n)));
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get('dry_run') === '1';
  const limit = clampLimit(req.nextUrl.searchParams.get('limit'));

  const candidates = listAutoDispositionCandidates(limit);

  // Cache campaigns so a backfill over a single big campaign
  // doesn't hit the campaigns table once per row.
  const campaignCache = new Map<string, AutoDispoCampaign | null>();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  const distribution: Record<string, number> = {};

  for (const row of candidates) {
    scanned += 1;
    let campaign = campaignCache.get(row.campaign_id);
    if (campaign === undefined) {
      const c = getCampaignFromDb(row.campaign_id);
      campaign = c
        ? { amd_action: c.amd_action, voicemail_path: c.voicemail_path }
        : null;
      campaignCache.set(row.campaign_id, campaign);
    }
    const auto = inferAutoDisposition(
      {
        disposition: row.disposition,
        originate_error: row.originate_error,
        answered_at: row.answered_at,
        assigned_user_id: row.assigned_user_id,
        hangup_cause: row.hangup_cause,
        amd_result: row.amd_result,
      },
      campaign ?? undefined,
    );
    if (!auto) {
      skipped += 1;
      continue;
    }
    distribution[auto] = (distribution[auto] ?? 0) + 1;
    if (dryRun) {
      updated += 1;
      continue;
    }
    if (!row.correlation_id) {
      // Pre-iter-79 rows without correlation_id can't be matched
      // by the helper's WHERE clause. Skip them — there shouldn't
      // be any on a freshly-provisioned box, but defensive guards
      // are cheap.
      skipped += 1;
      continue;
    }
    const applied = applyAutoDisposition(row.correlation_id, auto);
    if (applied) updated += 1;
    else skipped += 1;
  }

  return NextResponse.json({
    dry_run: dryRun,
    limit,
    scanned,
    updated,
    skipped,
    distribution,
    note:
      scanned >= limit
        ? 'limit reached — re-run for the next batch'
        : 'no more candidates',
  });
}
