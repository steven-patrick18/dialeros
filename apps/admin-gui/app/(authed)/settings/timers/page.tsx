import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { TimersClient } from './client';

export const dynamic = 'force-dynamic';

export default async function TimersPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Timer health</h1>
        <p className="text-error text-sm">
          Admin or supervisor role required.
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold mb-1">Timer health</h1>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        Every <code className="text-xs">dialeros-*.timer</code> on
        the box, with last-run + next-run + last-exit status. Live
        view — re-fetches every 15 seconds. Failures sort to the
        top. Click a row to copy the journalctl command.
      </p>
      <TimersClient />
    </div>
  );
}
