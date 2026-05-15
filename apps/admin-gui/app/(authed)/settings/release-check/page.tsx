import { redirect } from 'next/navigation';
import { getBuildInfo } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { ReleaseCheckClient } from './client';

export const dynamic = 'force-dynamic';

// Iter 188 — 1.0 release-readiness dashboard. Pure server shell;
// the client component fetches /api/release-check so an operator
// can re-run the check after fixing a gate without a full reload.

export default async function ReleaseCheckPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Release check</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }
  const build = getBuildInfo();
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-1">
        Release readiness — v{build.version}
      </h1>
      <p className="text-fg-subtle text-sm mb-6">
        Pre-cutover self-check. Hard gates (carrier, route plan,
        admin, admin.env, subsystem health) force NO-GO when they
        fail. Soft gates (TLS, backups, SMTP, DNC, campaigns) warn
        but don&apos;t block. Re-run after fixing a gate.
      </p>
      <ReleaseCheckClient build={build} />
    </div>
  );
}
