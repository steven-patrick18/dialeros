import { NextRequest, NextResponse } from 'next/server';
import os from 'node:os';
import { stat } from 'node:fs/promises';
import {
  APP_SETTING_KEYS,
  extensionForUser,
  getAppSetting,
  getNodeFromDb,
  getPrimaryPhone,
  getUser,
  listNodesFromDb,
  parseNodeRoles,
  type NodeRecord,
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

  // Iter 62 — determine the telephony node that hosts the agent's
  // primary phone. Order of preference:
  //   1. primary phone has an explicit telephony_node_id pin
  //   2. only one telephony-role node exists → use that (single-box)
  //   3. is_self node → use that
  //   4. fall back to local IP
  const primary = getPrimaryPhone(user.id);
  const node = resolveTelephonyNode(primary?.telephony_node_id ?? null);
  const sipDomain = node?.host ?? localExternalIp();

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
    // Iter 62 — when an explicit telephony node was resolved we
    // route the unencrypted WS straight at its host instead of
    // hopping through whatever the browser hit as Host:.
    const wsHost =
      node?.host ??
      (req.headers.get('x-forwarded-host') ??
        req.headers.get('host') ??
        '127.0.0.1').split(':')[0]!;
    wsUrl = `ws://${wsHost}:5066`;
  }

  // Iter 40 / 63 — prefer the user's primary phone (real provisioned
  // creds). If they don't own one yet (which after iter 63's backfill
  // should be rare), fall back to:
  //   1. the username itself if it's already 3-6 digits — agents
  //      typically log in as "1001" and expect extension 1001 to
  //      come up;
  //   2. the iter-35 hash of user.id only as a last resort.
  // Password defaults to FreeSWITCH's stock 1234 so the legacy
  // directory entries still work.
  const usernameIsExt = /^[0-9]{3,6}$/.test(user.username);
  const extension =
    primary?.extension ??
    (usernameIsExt ? user.username : extensionForUser(user.id));
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
    telephony_node: node
      ? { id: node.id, name: node.name, host: node.host }
      : null,
  });
}

// Iter 62 — pick the right telephony node for this phone. Encoded
// as a function so the order-of-preference is auditable in one
// place: explicit pin → only-telephony-node → is_self → null.
function resolveTelephonyNode(pinned: string | null): NodeRecord | null {
  if (pinned) {
    const n = getNodeFromDb(pinned);
    if (n && parseNodeRoles(n).includes('telephony')) return n;
  }
  const telephony = listNodesFromDb().filter((n) =>
    parseNodeRoles(n).includes('telephony'),
  );
  if (telephony.length === 1) return telephony[0]!;
  const self = telephony.find((n) => n.is_self === 1);
  if (self) return self;
  return telephony[0] ?? null;
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
