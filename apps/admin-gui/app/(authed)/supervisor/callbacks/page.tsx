import { redirect } from 'next/navigation';
import { listCallbackRequests } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { CallbacksList } from './list';

export const dynamic = 'force-dynamic';

// Iter 178 — Supervisor view of callback requests. Pending
// rows first (FIFO), then recent resolved rows. Supervisors
// can cancel a pending or dispatched row.

export default async function CallbacksPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">
          Callback requests
        </h1>
        <p className="text-error text-sm">
          Admin or supervisor role required.
        </p>
      </div>
    );
  }

  // Plain-object serialization to keep node:sqlite rows
  // crossing the RSC boundary safely.
  const rows = JSON.parse(
    JSON.stringify(listCallbackRequests('', 200)),
  ) as ReturnType<typeof listCallbackRequests>;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Callback requests</h1>
      <p className="text-fg-subtle text-sm mb-6">
        Inbound callers who pressed the configured DTMF digit
        while parked in an in-group hold queue. Pending requests
        are at the top — a future iter&apos;s worker will dispatch
        these automatically; for now you can cancel a row that
        you&apos;ve already handled out-of-band.
      </p>
      <CallbacksList initialRows={rows} />
    </div>
  );
}
