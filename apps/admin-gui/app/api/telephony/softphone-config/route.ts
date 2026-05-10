import { NextRequest, NextResponse } from 'next/server';
import os from 'node:os';
import { stat } from 'node:fs/promises';
import {
  APP_SETTING_KEYS,
  extensionForUser,
  getAppSetting,
  getPrimaryPhone,
  getUser,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Iter 35b/36 — config the browser softphone needs to register.
 *
 * Two distinct concepts that look similar but aren't:
 *
 *   ws_url   — where sip.js opens its WebSocket. Goes through nginx
 *              (wss://<domain>/sip) when TLS is up so signaling is
 *              encrypted, else plain ws://<host>:5066 directly to FS.
 *   sip uri  — the SIP identity we register as. The DOMAIN part has
 *              to match FreeSWITCH's default_domain (the local IP)
 *              because that's where users 1000-1019 live in the FS
 *              directory. If we used the canonical hostname here
 *              instead, REGISTER would 403-forbidden because FS
 *              wouldn't find the user in that domain's directory.
 *
 * For now everyone shares the FS default users / pw 1234. Per-admin
 * SIP creds are a later iter.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const domain = getAppSetting(APP_SETTING_KEYS.canonicalDomain);
  let wsUrl: string;
  let secure = false;
  if (domain && (await certExists(domain))) {
    // Browser → FS direct on the WSS port, NOT via nginx /sip.
    // nginx terminates TLS, which causes a Via:WSS-vs-WS transport
    // mismatch at the SIP layer that makes FS silently drop our
    // REGISTERs. setup-tls.sh feeds the Let's Encrypt cert into
    // /etc/freeswitch/tls/wss.pem so browsers trust the direct
    // connection.
    wsUrl = `wss://${domain}:7443/`;
    secure = true;
  } else {
    const host =
      req.headers.get('x-forwarded-host') ??
      req.headers.get('host') ??
      '127.0.0.1';
    const wsHost = host.split(':')[0]!;
    wsUrl = `ws://${wsHost}:5066`;
  }

  // SIP domain is ALWAYS the local network interface IP — that's what
  // FreeSWITCH's default_domain is, and that's where the FS directory
  // lives. Independent of where the WebSocket connects.
  const sipDomain = localExternalIp();

  // Iter 40 — prefer the user's primary phone (real provisioned creds).
  // If they don't own one yet, fall back to the iter-35 hash + the FS
  // default `1234` password so the migration is non-destructive.
  const primary = getPrimaryPhone(user.id);
  const extension = primary?.extension ?? extensionForUser(user.id);
  const password = primary?.password ?? '1234';

  // manual_dial gates the dialer input on the agent softphone — only
  // expert-level users can place outbound manually.
  const userRecord = getUser(user.id);
  const manualDial = userRecord?.manual_dial === 1;

  return NextResponse.json({
    extension,
    uri: `sip:${extension}@${sipDomain}`,
    ws_url: wsUrl,
    secure,
    password,
    display_name: user.username,
    manual_dial: manualDial,
  });
}

async function certExists(domain: string): Promise<boolean> {
  try {
    await stat(`/etc/letsencrypt/live/${domain}/fullchain.pem`);
    return true;
  } catch {
    return false;
  }
}

function localExternalIp(): string {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}
