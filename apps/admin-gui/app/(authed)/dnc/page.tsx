import { redirect } from 'next/navigation';
import { countDnc, listDnc } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { DncManager } from './manager';

export const dynamic = 'force-dynamic';

export default async function DncPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Do Not Call</h1>
        <p className="text-error text-sm">Admin or supervisor role required.</p>
      </div>
    );
  }

  const total = countDnc();
  const initial = listDnc(200, 0);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Do Not Call</h1>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        Numbers here are blocked at every originate path — pacer, agent
        manual dial, admin test call. Phones are normalised on save, so
        pasting{' '}
        <span className="font-mono">(202) 555-0123</span>,{' '}
        <span className="font-mono">1-202-555-0123</span>, and{' '}
        <span className="font-mono">+12025550123</span> all match the
        same lookup.
      </p>
      <DncManager
        total={total}
        initial={initial.map((p) => ({
          phone: p.phone,
          reason: p.reason,
          added_at: p.added_at,
          added_by_user_id: p.added_by_user_id,
        }))}
      />
    </div>
  );
}
