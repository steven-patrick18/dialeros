import { NextRequest, NextResponse } from 'next/server';
import {
  CampaignDispositionPaletteSchema,
  appendAudit,
  getCampaign,
  getCampaignDispositionPalette,
  saveCampaignDispositionPalette,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 174 — Per-campaign disposition palette.
// GET — any authenticated user (agents need it for wrap-up).
// PUT — admin only. Replace-all semantics.

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
    palette: getCampaignDispositionPalette(id),
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
  const parsed = CampaignDispositionPaletteSchema.safeParse(
    (body as { palette?: unknown })?.palette ?? body,
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const result = saveCampaignDispositionPalette(id, parsed.data);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'campaign_dispositions.saved',
    targetType: 'campaign',
    targetId: id,
    payload: { count: result.count },
  });
  return NextResponse.json({
    ok: true,
    count: result.count,
    palette: getCampaignDispositionPalette(id),
  });
}
