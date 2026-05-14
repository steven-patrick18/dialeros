import { redirect } from 'next/navigation';
import { listConsentRecords } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { ConsentRecordsClient } from './client';

export const dynamic = 'force-dynamic';

// Iter 168 — Consent records admin page. Admin + supervisor.
// Initial hydration uses ?active_only / ?phone search params so a
// regulator-share link points at exactly the rows they need.

export default async function ConsentRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; active_only?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Consent records</h1>
        <p className="text-error text-sm">
          Admin or supervisor role required.
        </p>
      </div>
    );
  }
  const { phone, active_only } = await searchParams;
  const records = JSON.parse(
    JSON.stringify(
      listConsentRecords({
        phone: phone || undefined,
        active_only: active_only === '1',
        limit: 200,
      }),
    ),
  );
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold mb-1">Consent records</h1>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        Searchable &quot;they said yes&quot; log for TCPA
        defensibility. Each row records when a lead granted express
        permission to be called + the evidence pointer (web form
        URL, signed PDF filename, recording id). Revocation is
        immediate and audit-logged; revoked records stay in the
        table so regulators can replay the full timeline.
      </p>
      <ConsentRecordsClient
        initial={records}
        canEdit={me.role === 'admin' || me.role === 'supervisor'}
        canDelete={me.role === 'admin'}
      />
    </div>
  );
}
