import { redirect } from 'next/navigation';
import { getSmtpConfig } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { SmtpForm } from './form';

export const dynamic = 'force-dynamic';

export default async function SmtpSettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">SMTP / email</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const cfg = getSmtpConfig();
  const initial = {
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    from: cfg.from,
    starttls: cfg.starttls,
    password_set: Boolean(cfg.password),
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-1">SMTP / email</h1>
      <p className="text-fg-subtle text-sm mb-6">
        Relay config used by the iter-131 daily-report timer + any
        future operator-side notifications. Backed by{' '}
        <code className="text-xs">msmtp</code> with config written
        to <code className="text-xs">/etc/msmtprc</code> on each
        save. First-time setup: run{' '}
        <code className="text-xs">
          sudo /opt/dialeros/scripts/install-smtp.sh
        </code>{' '}
        on the VPS to install <code>msmtp</code> + fix file perms,
        then fill in the form below and click Save.
      </p>
      <SmtpForm initial={initial} />
    </div>
  );
}
