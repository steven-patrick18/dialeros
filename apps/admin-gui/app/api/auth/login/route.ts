import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  LoginInputSchema,
  appendAudit,
  isSetupComplete,
  login,
} from '@dialeros/control-plane';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, clientIp } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!isSetupComplete()) {
    return NextResponse.json(
      { error: 'Setup not yet completed.' },
      { status: 409 },
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = LoginInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Username and password are required.' },
      { status: 400 },
    );
  }

  const ip = clientIp(req);
  const userAgent = req.headers.get('user-agent');

  const result = login(parsed.data, { ip, userAgent });

  if (!result) {
    appendAudit({
      actorUserId: null,
      actorIp: ip,
      action: 'user.login_failure',
      targetType: 'user',
      targetId: null,
      payload: { username: parsed.data.username },
    });
    return NextResponse.json(
      { error: 'Invalid username or password.' },
      { status: 401 },
    );
  }

  appendAudit({
    actorUserId: result.user.id,
    actorIp: ip,
    action: 'user.login_success',
    targetType: 'user',
    targetId: result.user.id,
    payload: { username: result.user.username },
  });

  const c = await cookies();
  c.set(SESSION_COOKIE, result.sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return NextResponse.json({
    ok: true,
    user: {
      id: result.user.id,
      username: result.user.username,
      role: result.user.role,
    },
  });
}
