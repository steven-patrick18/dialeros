import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  getCallbackDtmfDigit,
  getCallbackEnabled,
  getCallbackTtlMinutes,
  setCallbackDtmfDigit,
  setCallbackEnabled,
  setCallbackTtlMinutes,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 178 — Inbound callback settings. Admin-only.

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    enabled: getCallbackEnabled(),
    digit: getCallbackDtmfDigit(),
    ttlMinutes: getCallbackTtlMinutes(),
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
  const obj = body as {
    enabled?: unknown;
    digit?: unknown;
    ttlMinutes?: unknown;
  };

  if (typeof obj.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'enabled must be boolean' },
      { status: 400 },
    );
  }
  if (typeof obj.digit !== 'string' || !/^[0-9*#]$/.test(obj.digit)) {
    return NextResponse.json(
      { error: 'digit must be one of 0-9, *, #' },
      { status: 400 },
    );
  }
  if (
    typeof obj.ttlMinutes !== 'number' ||
    !Number.isInteger(obj.ttlMinutes) ||
    obj.ttlMinutes < 1 ||
    obj.ttlMinutes > 1440
  ) {
    return NextResponse.json(
      { error: 'ttlMinutes must be 1..1440' },
      { status: 400 },
    );
  }

  setCallbackEnabled(obj.enabled);
  setCallbackDtmfDigit(obj.digit);
  setCallbackTtlMinutes(obj.ttlMinutes);

  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'settings.callback',
    targetType: 'app_setting',
    targetId: 'callback',
    payload: {
      enabled: obj.enabled,
      digit: obj.digit,
      ttl_minutes: obj.ttlMinutes,
    },
  });

  return NextResponse.json({
    enabled: getCallbackEnabled(),
    digit: getCallbackDtmfDigit(),
    ttlMinutes: getCallbackTtlMinutes(),
  });
}
