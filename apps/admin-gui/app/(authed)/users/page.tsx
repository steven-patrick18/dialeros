import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listUsers } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const ROLE_STYLES: Record<string, string> = {
  admin: 'bg-accent/15 text-accent border-accent/50',
  supervisor: 'bg-success/15 text-success border-success/50',
  agent: 'bg-warn/15 text-warn border-warn/50',
  operator: 'bg-card-hover/40 text-fg-muted border-border',
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ inactive?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Users</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }
  const sp = await searchParams;
  const showInactive = sp.inactive === '1';
  const users = listUsers(showInactive);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Users</h1>
        <Link
          href="/users/add"
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm"
        >
          + New User
        </Link>
      </div>

      <p className="text-fg-subtle text-sm mb-4 max-w-2xl">
        Manage admins, supervisors, and agents. Deactivated users cannot log
        in; their sessions are dropped immediately when you deactivate them.
      </p>

      <div className="mb-4 text-xs">
        {showInactive ? (
          <Link href="/users" className="text-accent hover:underline">
            Hide inactive
          </Link>
        ) : (
          <Link href="/users?inactive=1" className="text-accent hover:underline">
            Show inactive too
          </Link>
        )}
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-fg-subtle border-b border-border">
          <tr>
            <th className="py-2 font-medium">Username</th>
            <th className="font-medium">Display name</th>
            <th className="font-medium">Role</th>
            <th className="font-medium">Skill</th>
            <th className="font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-border/50">
              <td className="py-3">
                <Link href={`/users/${u.id}`} className="hover:underline">
                  {u.username}
                </Link>
                {u.id === me.id && (
                  <span className="text-fg-subtle text-xs ml-2">(you)</span>
                )}
              </td>
              <td className="text-fg-muted">
                {u.display_name ?? <span className="text-fg-subtle">—</span>}
              </td>
              <td>
                <span
                  className={`${ROLE_STYLES[u.role] ?? ROLE_STYLES.operator} border px-2 py-0.5 rounded text-xs uppercase`}
                >
                  {u.role}
                </span>
              </td>
              <td className="text-fg-muted text-xs font-mono">
                {u.skill_tier}
              </td>
              <td>
                {u.is_active === 1 ? (
                  <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
                    ACTIVE
                  </span>
                ) : (
                  <span className="bg-error/10 text-error border border-error/50 px-2 py-0.5 rounded text-xs">
                    INACTIVE
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
