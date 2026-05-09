import { cookies } from 'next/headers';
import { getUserBySession, type UserRecord } from '@dialeros/control-plane';

export const SESSION_COOKIE = 'dialeros_session';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export async function getCurrentUser(): Promise<UserRecord | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  return getUserBySession(sessionId);
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip');
}
