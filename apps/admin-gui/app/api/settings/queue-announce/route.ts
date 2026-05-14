import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  getQueueAnnounceEnabled,
  setQueueAnnounceEnabled,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 177 — Queue position announce toggle. Single boolean
// stored in app_settings. Admin-only.

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    enabled: getQueueAnnounceEnabled(),
  });
}

export async function PUT(req: NextRequest) {
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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const obj = body as { enabled?: unknown };
  if (typeof obj.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'enabled must be boolean' },
      { status: 400 },
    );
  }
  setQueueAnnounceEnabled(obj.enabled);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'settings.queue_announce',
    targetType: 'app_setting',
    targetId: 'queue.announce_enabled',
    payload: { enabled: obj.enabled },
  });
  return NextResponse.json({
    enabled: getQueueAnnounceEnabled(),
  });
}
