import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SetupInputSchema,
  appendAudit,
  createFirstAdmin,
  isSetupComplete,
} from '@dialeros/control-plane';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, clientIp } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (isSetupComplete()) {
    return NextResponse.json(
      { error: 'Setup already completed.' },
      { status: 409 },
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = SetupInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
          .join('; '),
      },
      { status: 400 },
    );
  }

  const ip = clientIp(req);
  const userAgent = req.headers.get('user-agent');

  try {
    const { user, sessionId } = createFirstAdmin(parsed.data, {
      ip,
      userAgent,
    });

    appendAudit({
      actorUserId: user.id,
      actorIp: ip,
      action: 'user.created',
      targetType: 'user',
      targetId: user.id,
      payload: { username: user.username, role: user.role, via: 'setup' },
    });
    appendAudit({
      actorUserId: user.id,
      actorIp: ip,
      action: 'user.login_success',
      targetType: 'user',
      targetId: user.id,
      payload: { via: 'setup' },
    });

    const c = await cookies();
    c.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return NextResponse.json({
      ok: true,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Setup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
