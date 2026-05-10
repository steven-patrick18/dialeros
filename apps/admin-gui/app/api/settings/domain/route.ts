import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  APP_SETTING_KEYS,
  appendAudit,
  clearAppSetting,
  getAppSetting,
  setAppSetting,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Domain shape: standard hostname rules — alphanumeric labels separated
// by dots, total ≤253 chars. Permissive on top-level (no IDN punycode
// validation today; user can paste already-punycoded forms if needed).
const Domain = z
  .string()
  .min(3)
  .max(253)
  .regex(
    /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i,
    'Looks like an invalid hostname.',
  )
  .transform((s) => s.toLowerCase());

const PutBody = z.object({
  domain: Domain,
  contact_email: z.string().email().optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    domain: getAppSetting(APP_SETTING_KEYS.canonicalDomain),
    contact_email: getAppSetting(APP_SETTING_KEYS.tlsContactEmail),
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
  const parsed = PutBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  setAppSetting(APP_SETTING_KEYS.canonicalDomain, parsed.data.domain);
  if (parsed.data.contact_email) {
    setAppSetting(APP_SETTING_KEYS.tlsContactEmail, parsed.data.contact_email);
  }

  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'settings.domain.set',
    targetType: 'app_setting',
    targetId: APP_SETTING_KEYS.canonicalDomain,
    payload: { domain: parsed.data.domain },
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
  clearAppSetting(APP_SETTING_KEYS.canonicalDomain);
  clearAppSetting(APP_SETTING_KEYS.tlsContactEmail);
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'settings.domain.clear',
    targetType: 'app_setting',
    targetId: APP_SETTING_KEYS.canonicalDomain,
    payload: {},
  });
  return NextResponse.json({ ok: true });
}
