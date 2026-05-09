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

/**
 * Whether to set the `secure` flag on auth cookies for the current request.
 *
 * `secure: true` makes browsers refuse to store the cookie unless the
 * request was over HTTPS. In dev/HTTP-only deployments that means login
 * silently fails — the user appears to log in but the cookie never sticks.
 *
 * Detection: trust the request URL's protocol, or `x-forwarded-proto` when
 * we're behind nginx/cloudflare. NODE_ENV is intentionally NOT used —
 * production-on-HTTP is a real (if non-ideal) deployment shape.
 */
export function cookieSecureForRequest(req: Request): boolean {
  const fwd = req.headers.get('x-forwarded-proto');
  if (fwd) return fwd.toLowerCase() === 'https';
  try {
    return new URL(req.url).protocol === 'https:';
  } catch {
    return false;
  }
}
