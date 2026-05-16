import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  getAiLiveEnabled,
  setAiLiveEnabled,
  userHasPermission,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 195 — master switch for live AI calls. ai.manage only.
// Off by default; flipping it on without mod_audio_stream
// compiled just means the pacer routes to an inert extension —
// the call answers + parks silently — so the UI warns hard.

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json({ error: 'ai.manage required' }, { status: 403 });
  }
  return NextResponse.json({ live_enabled: getAiLiveEnabled() });
}

export async function PUT(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json({ error: 'ai.manage required' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const on = (body as { enabled?: unknown }).enabled;
  if (typeof on !== 'boolean') {
    return NextResponse.json(
      { error: 'enabled must be boolean' },
      { status: 400 },
    );
  }
  setAiLiveEnabled(on);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'ai.live_enabled',
    targetType: 'app_setting',
    targetId: 'ai.live_enabled',
    payload: { enabled: on },
  });
  return NextResponse.json({ live_enabled: getAiLiveEnabled() });
}
