import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { AddUserForm } from './add-form';

export const dynamic = 'force-dynamic';

export default async function AddUserPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">New User</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">New User</h1>
      <p className="text-fg-muted mb-6 text-sm max-w-xl">
        Set the initial password — the user can change it after their first
        login (self-service password change lands later).
      </p>
      <AddUserForm />
    </div>
  );
}
