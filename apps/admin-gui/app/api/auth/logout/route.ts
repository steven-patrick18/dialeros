import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { appendAudit, getUserBySession, logout } from '@dialeros/control-plane';
import { SESSION_COOKIE, clientIp } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const c = await cookies();
  const sessionId = c.get(SESSION_COOKIE)?.value;

  if (sessionId) {
    const user = getUserBySession(sessionId);
    logout(sessionId);
    if (user) {
      appendAudit({
        actorUserId: user.id,
        actorIp: clientIp(req),
        action: 'user.logout',
        targetType: 'user',
        targetId: user.id,
        payload: { username: user.username },
      });
    }
  }

  c.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
