import { redirect } from 'next/navigation';
import { countUsersPerOrg, listOrgs } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { OrgsEditor } from './editor';

export const dynamic = 'force-dynamic';

// Iter 181 — Multi-org foundation. Admin-only registry surface
// for tenant orgs. iter 181 lays the schema + admin tooling; the
// per-query org_id filtering for resources (campaigns, leads,
// in-groups, audit_events) lands in subsequent Phase F iters.

export default async function OrgsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Organizations</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const rows = JSON.parse(JSON.stringify(listOrgs())) as ReturnType<
    typeof listOrgs
  >;
  const counts = countUsersPerOrg();

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-1">Organizations</h1>
      <p className="text-fg-subtle text-sm mb-6">
        Tenant orgs. Each user belongs to exactly one. The
        <span className="font-mono"> default </span> org is the
        catch-all — legacy rows pre-iter-181 sit here and it
        can&apos;t be deleted. Per-resource isolation (campaigns,
        in-groups, leads, audit) ships in later Phase F iters.
      </p>
      <OrgsEditor initialRows={rows} userCounts={counts} />
    </div>
  );
}
