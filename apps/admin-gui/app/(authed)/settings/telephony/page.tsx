import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  APP_SETTING_KEYS,
  hasAppSetting,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { TokenForm } from './token-form';
import { InstallPanel } from './install-panel';

export const dynamic = 'force-dynamic';

export default async function TelephonySettings() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') {
    return (
      <div>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const hasToken = hasAppSetting(APP_SETTING_KEYS.signalwireToken);

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          &larr; Dashboard
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-1">Telephony</h1>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        FreeSWITCH is the media + dialplan engine. Install it once on this
        host using your SignalWire token, then the dialer can originate
        outbound calls and route inbound ones to agents.
      </p>

      <div className="max-w-3xl space-y-6">
        <TokenForm hasToken={hasToken} />
        <InstallPanel hasToken={hasToken} />
      </div>
    </div>
  );
}
