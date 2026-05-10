import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  APP_SETTING_KEYS,
  getAppSetting,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { DomainPanel } from './domain-panel';

export const dynamic = 'force-dynamic';

export default async function DomainSettings() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') {
    return (
      <div>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const domain = getAppSetting(APP_SETTING_KEYS.canonicalDomain);
  const email = getAppSetting(APP_SETTING_KEYS.tlsContactEmail);

  return (
    <div>
      <div className="mb-1">
        <Link href="/" className="text-xs text-fg-subtle hover:text-fg-muted">
          &larr; Dashboard
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-1">Domain &amp; TLS</h1>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        Point a domain at this server and we&apos;ll provision a free
        Let&apos;s Encrypt cert + reverse-proxy via nginx. After setup the
        admin GUI lives at <span className="font-mono">https://&lt;your-domain&gt;/</span>{' '}
        and the browser softphone connects via <span className="font-mono">wss://&lt;your-domain&gt;/sip</span>{' '}
        (encrypted SIP signaling instead of <span className="font-mono">ws://</span>).
      </p>

      <DomainPanel
        initialDomain={domain ?? ''}
        initialEmail={email ?? ''}
      />
    </div>
  );
}
