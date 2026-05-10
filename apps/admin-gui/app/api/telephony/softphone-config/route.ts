import { NextRequest, NextResponse } from 'next/server';
import { stat } from 'node:fs/promises';
import {
  APP_SETTING_KEYS,
  getAppSetting,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Iter 35b/36 — config the browser softphone needs to register.
 *
 * If a domain is saved AND a Let's Encrypt cert exists for it, the
 * browser is told to use wss://<domain>/sip (nginx terminates TLS,
 * proxies to FreeSWITCH on 127.0.0.1:5066). Otherwise we fall back
 * to plain ws:// against whatever host the request came in on.
 *
 * For now everyone shares the FS default users 1000-1019 / pw 1234.
 * Per-admin SIP creds are a later iter.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const domain = getAppSetting(APP_SETTING_KEYS.canonicalDomain);
  let wsUrl: string;
  let sipHost: string;
  let secure = false;
  if (domain && (await certExists(domain))) {
    wsUrl = `wss://${domain}/sip`;
    sipHost = domain;
    secure = true;
  } else {
    const host =
      req.headers.get('x-forwarded-host') ??
      req.headers.get('host') ??
      '127.0.0.1';
    sipHost = host.split(':')[0]!;
    wsUrl = `ws://${sipHost}:5066`;
  }

  const extension = 1000 + (hash(user.id) % 20);

  return NextResponse.json({
    extension: String(extension),
    uri: `sip:${extension}@${sipHost}`,
    ws_url: wsUrl,
    secure,
    password: '1234',
    display_name: user.username,
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

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
