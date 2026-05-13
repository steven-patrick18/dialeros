import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { CallMenuForm } from '../menu-form';

export const dynamic = 'force-dynamic';

export default async function NewCallMenuPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">New Call Menu</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">New Call Menu</h1>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        DTMF menu definition. Add at least one digit option, set a
        default action for timeout/invalid input, save, then wire
        it as a DID / in-group / campaign target on those pages
        (iter 151).
      </p>
      <CallMenuForm />
    </div>
  );
}
