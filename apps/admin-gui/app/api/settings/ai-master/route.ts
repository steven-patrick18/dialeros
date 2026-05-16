import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  getAiMaster,
  setAiMasterEnabled,
  userHasPermission,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 199 — Global Master AI skeleton. enable toggle only;
// memory / exemplars / transfer-learning land iters 200+.
// ai.manage gated.

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json({ error: 'ai.manage required' }, { status: 403 });
  }
  const m = getAiMaster();
  return NextResponse.json({ enabled: m.enabled === 1 });
}

export async function PUT(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json({ error: 'ai.manage required' }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof b.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'enabled must be boolean' },
      { status: 400 },
    );
  }
  setAiMasterEnabled(b.enabled);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'ai.master_enabled',
    targetType: 'ai_master',
    targetId: 'global',
    payload: { enabled: b.enabled },
  });
  return NextResponse.json({ enabled: getAiMaster().enabled === 1 });
}
