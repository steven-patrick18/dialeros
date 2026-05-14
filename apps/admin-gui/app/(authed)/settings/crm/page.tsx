import { redirect } from 'next/navigation';
import {
  crmProviderToSafe,
  listCrmProviders,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { CrmEditor } from './editor';

export const dynamic = 'force-dynamic';

// Iter 185 — Admin CRM providers page. Per-org registry; one
// provider can be enabled at a time. The agent feed uses the
// enabled provider for inline CRM lookups via /api/agent/crm-lookup.
// API keys are encrypted-at-rest via the secrets.ts envelope used
// by SMTP + SignalWire.

export default async function CrmSettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">CRM</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }
  // Scope to the caller's own org. Until cross-org admin lands
  // every admin sees only their own org's providers.
  const rows = JSON.parse(
    JSON.stringify(listCrmProviders(me.org_id).map(crmProviderToSafe)),
  ) as Array<ReturnType<typeof crmProviderToSafe>>;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold mb-1">CRM providers</h1>
      <p className="text-fg-subtle text-sm mb-6">
        External CRM connections. Once a provider is enabled,
        agents see a CRM lookup button on each live call that
        resolves the lead&apos;s phone to a contact record. API
        keys are encrypted-at-rest and never echoed back through
        the API. Only one provider per org may be enabled at a
        time; toggling another disables the prior.
      </p>
      <CrmEditor initialRows={rows} />
    </div>
  );
}
