import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  APP_SETTING_KEYS,
  appendAudit,
  clearAppSetting,
  hasAppSetting,
  setAppSetting,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TokenBody = z.object({
  token: z.string().min(8, 'SignalWire tokens are longer than 8 chars.').max(200),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  // Never return the token itself — only whether one exists.
  return NextResponse.json({
    has_token: hasAppSetting(APP_SETTING_KEYS.signalwireToken),
  });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = TokenBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid token.' },
      { status: 400 },
    );
  }
  setAppSetting(APP_SETTING_KEYS.signalwireToken, parsed.data.token.trim());
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'settings.signalwire_token.set',
    targetType: 'app_setting',
    targetId: APP_SETTING_KEYS.signalwireToken,
    payload: { length: parsed.data.token.trim().length },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  clearAppSetting(APP_SETTING_KEYS.signalwireToken);
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'settings.signalwire_token.clear',
    targetType: 'app_setting',
    targetId: APP_SETTING_KEYS.signalwireToken,
    payload: {},
  });
  return NextResponse.json({ ok: true });
}
