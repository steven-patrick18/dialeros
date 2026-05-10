import { NextResponse } from 'next/server';
import { stat, readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import {
  APP_SETTING_KEYS,
  getAppSetting,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const domain = getAppSetting(APP_SETTING_KEYS.canonicalDomain);
  if (!domain) {
    return NextResponse.json({ configured: false });
  }
  const certPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
  try {
    await stat(certPath);
  } catch {
    return NextResponse.json({
      configured: true,
      domain,
      cert_exists: false,
      hint: 'No Let\'s Encrypt cert yet. Run "Set up TLS" once DNS resolves to this host.',
    });
  }
  try {
    const pem = await readFile(certPath, 'utf8');
    const cert = new X509Certificate(pem);
    const validTo = new Date(cert.validTo);
    const daysLeft = Math.round(
      (validTo.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );
    return NextResponse.json({
      configured: true,
      domain,
      cert_exists: true,
      subject: cert.subject,
      issuer: cert.issuer,
      valid_to: cert.validTo,
      days_left: daysLeft,
      sans: cert.subjectAltName,
    });
  } catch (e) {
    return NextResponse.json({
      configured: true,
      domain,
      cert_exists: true,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
