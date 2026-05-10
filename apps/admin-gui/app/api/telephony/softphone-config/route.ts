import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Iter 35b — config the browser softphone needs to register.
 *
 * For now everything is hardcoded against the install-freeswitch.sh
 * defaults: WS on port 5066 of this host, users 1000-1019 with
 * password 1234. We assign one extension per logged-in user via a
 * stable hash of their id, so the same admin always gets the same
 * extension across reloads.
 *
 * Production would:
 *   - Provision a unique SIP user per admin/agent on demand,
 *     dropped under /etc/freeswitch/directory/default/.
 *   - Generate a strong per-user password and store its hash.
 *   - Use WSS with a real cert.
 * That work lands once we have user-managed SIP creds + per-agent
 * registration tracking.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Extract host the browser used so the softphone connects to the
  // same address (avoids "the GUI says 198.x but the browser only
  // resolves softphone.example.com" mismatches in dev).
  const host =
    req.headers.get('x-forwarded-host') ??
    req.headers.get('host') ??
    '127.0.0.1';
  const sipHost = host.split(':')[0]; // strip admin-gui port

  // Stable extension assignment 1000..1019.
  const extension = 1000 + (hash(user.id) % 20);

  return NextResponse.json({
    extension: String(extension),
    uri: `sip:${extension}@${sipHost}`,
    ws_url: `ws://${sipHost}:5066`,
    password: '1234',
    display_name: user.username,
  });
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
