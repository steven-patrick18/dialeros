import { NextRequest, NextResponse } from 'next/server';
import { listFloorCallHistory } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 142 — Floor-wide call history feed for the supervisor
// /supervisor/calls page. Admin + supervisor only. Filters are
// passed via query string; an empty/missing value means "no
// filter" for that field. Defaults: last 24h, limit 200.
//
// Hard-capped at 500 rows server-side regardless of the limit
// query param so a misclick can't drag the whole dial_intents
// table into RAM.

function clampLimit(raw: string | null): number {
  if (!raw) return 200;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 200;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

function defaultSinceIso(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString();
}

export async function GET(req: NextRequest) {
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
  const sp = req.nextUrl.searchParams;
  const rows = listFloorCallHistory({
    sinceIso: sp.get('since') || defaultSinceIso(),
    untilIso: sp.get('until') || null,
    campaignId: sp.get('campaign_id') || null,
    agentUserId: sp.get('agent_id') || null,
    disposition: sp.get('disposition') || null,
    amdResult: sp.get('amd_result') || null,
    onlyWithRecording: sp.get('only_with_recording') === '1',
    limit: clampLimit(sp.get('limit')),
  });
  return NextResponse.json({ rows });
}
