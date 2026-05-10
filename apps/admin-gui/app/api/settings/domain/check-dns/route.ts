import { NextResponse } from 'next/server';
import dns from 'node:dns/promises';
import {
  APP_SETTING_KEYS,
  getAppSetting,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Iter 36 — resolve the saved domain and tell the user whether it
 * points at this VPS.
 *
 * "This VPS"'s public IP is detected by querying a few common
 * public-IP sources. We avoid hardcoding the IP since the install
 * could be on any host.
 */

async function publicIp(): Promise<string | null> {
  // Try /etc/dialeros-public-ip first (admin can override), then
  // ask icanhazip-style services. Each is a 2s budget; total 5s cap.
  try {
    const fs = await import('node:fs/promises');
    const v = (await fs.readFile('/etc/dialeros-public-ip', 'utf8')).trim();
    if (v) return v;
  } catch {
    /* not present, that's fine */
  }
  const services = [
    'https://ipv4.icanhazip.com/',
    'https://api.ipify.org/',
  ];
  for (const url of services) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) continue;
      const txt = (await res.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(txt)) return txt;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const domain = getAppSetting(APP_SETTING_KEYS.canonicalDomain);
  if (!domain) {
    return NextResponse.json(
      { ok: false, error: 'No domain saved.' },
      { status: 400 },
    );
  }

  const [resolved, ip] = await Promise.all([
    dns.resolve4(domain).catch(() => [] as string[]),
    publicIp(),
  ]);

  const matches = ip ? resolved.includes(ip) : false;
  return NextResponse.json({
    domain,
    resolved_to: resolved,
    public_ip: ip,
    matches,
    hint:
      matches
        ? 'DNS is correct. Ready to set up TLS.'
        : ip
          ? `Add an A record for ${domain} pointing to ${ip}, then re-check. DNS can take a few minutes to propagate.`
          : 'Could not auto-detect this server\'s public IP. Drop the IP into /etc/dialeros-public-ip to override.',
  });
}
