import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getCarrier,
  getRoutePlansForCarrier,
  parseCodecs,
} from '@dialeros/control-plane';
import { InlineCardForm } from '@/components/inline-card-form';
import { DeleteCarrierButton } from './delete-button';
import { FreeSwitchPanel } from './fs-panel';

export const dynamic = 'force-dynamic';

export default async function CarrierDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const carrier = getCarrier(id);
  if (!carrier) notFound();

  const codecs = parseCodecs(carrier);
  const usedBy = getRoutePlansForCarrier(id);

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/carriers"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          &larr; Carriers
        </Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">{carrier.name}</h1>
        {carrier.enabled === 1 ? (
          <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
            ENABLED
          </span>
        ) : (
          <span className="bg-card-hover/40 text-fg-muted border border-border px-2 py-0.5 rounded text-xs">
            DISABLED
          </span>
        )}
      </div>
      <p className="text-fg-subtle text-sm mb-6 font-mono">
        {carrier.transport}://{carrier.host}:{carrier.port}
      </p>

      <div className="max-w-4xl mb-6">
        <InlineCardForm
          title="Network"
          endpoint={`/api/carriers/${carrier.id}`}
          fields={[
            {
              type: 'text',
              name: 'name',
              label: 'Name',
              value: carrier.name,
              maxLength: 64,
              hint: 'Internal identifier. Letters, digits, dashes, underscores. Shown in the route-plan carrier picker.',
            },
            {
              type: 'text',
              name: 'host',
              label: 'Host',
              value: carrier.host,
              placeholder: 'sip.carrier.example.com',
              hint: 'SIP host the dialer registers to / sends INVITEs to. Hostname or IP. No port.',
            },
            {
              type: 'number',
              name: 'port',
              label: 'Port',
              value: carrier.port,
              min: 1,
              max: 65535,
              step: 1,
              hint: 'SIP port. Typically 5060 (UDP/TCP) or 5061 (TLS).',
            },
            {
              type: 'select',
              name: 'transport',
              label: 'Transport',
              value: carrier.transport,
              options: [
                { value: 'UDP', label: 'UDP' },
                { value: 'TCP', label: 'TCP' },
                { value: 'TLS', label: 'TLS (encrypted)' },
              ],
              hint: 'SIP transport. TLS is the only option that encrypts signaling - required by some regulators.',
            },
            {
              type: 'boolean',
              name: 'enabled',
              label: 'Enabled',
              value: carrier.enabled === 1,
              hint: 'Disabled carriers stay in inventory but route plans skip them. Use to take a carrier offline without deleting.',
            },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
        <InlineCardForm
          title="Authentication"
          endpoint={`/api/carriers/${carrier.id}`}
          fields={[
            {
              type: 'select',
              name: 'auth_mode',
              label: 'Mode',
              value: carrier.auth_mode,
              options: [
                { value: 'digest', label: 'digest - username + password' },
                { value: 'ip-acl', label: 'ip-acl - IP whitelist' },
              ],
              hint: 'digest sends SIP credentials on every request; ip-acl trusts requests from a whitelisted IP / CIDR. Some carriers offer both.',
            },
            {
              type: 'text',
              name: 'digest_username',
              label: 'Digest username',
              value: carrier.digest_username,
              hint: 'Required when mode is digest. Carrier-issued.',
            },
            {
              type: 'text',
              name: 'digest_password',
              label: 'Digest password',
              value: null,
              placeholder: carrier.digest_password_encrypted
                ? '(stored encrypted - leave blank to keep)'
                : '',
              hint: 'Required when mode is digest. Stored AES-256-GCM-encrypted at rest. Leave blank to keep the existing value.',
            },
            {
              type: 'text',
              name: 'ip_acl',
              label: 'IP allow-list',
              value: carrier.ip_acl,
              placeholder: '203.0.113.0/24, 198.51.100.7',
              hint: 'Required when mode is ip-acl. Comma-separated CIDR / single IPs.',
            },
          ]}
        />

        <InlineCardForm
          title="Codecs (preference order)"
          endpoint={`/api/carriers/${carrier.id}`}
          fields={[
            {
              type: 'lines',
              name: 'codecs',
              label: `Codecs (${codecs.length})`,
              value: codecs,
              placeholder: 'PCMU\nPCMA\nOPUS\nG729',
              hint: 'One per line, in preference order. Allowed: PCMU, PCMA, OPUS, G729. Topmost is offered first; carrier picks the first it supports.',
            },
          ]}
        />

        <InlineCardForm
          title="Capacity"
          endpoint={`/api/carriers/${carrier.id}`}
          fields={[
            {
              type: 'number',
              name: 'max_channels',
              label: 'Max channels',
              value: carrier.max_channels,
              min: 1,
              max: 10000,
              step: 1,
              hint: 'Concurrent calls cap. Pacer throttles when this carrier hits the cap to avoid SIP rejects.',
            },
            {
              type: 'number',
              name: 'max_cps',
              label: 'Max CPS',
              value: carrier.max_cps,
              min: 1,
              max: 1000,
              step: 1,
              hint: 'Calls-per-second ceiling. Most carriers enforce this server-side; matching it here prevents bursts that would be rejected.',
            },
          ]}
        />

        <InlineCardForm
          title="Quality"
          endpoint={`/api/carriers/${carrier.id}`}
          fields={[
            {
              type: 'number',
              name: 'mos_threshold',
              label: 'MOS threshold',
              value: carrier.mos_threshold,
              min: 0,
              max: 5,
              step: 0.1,
              hint: 'Mean Opinion Score floor (0-5). Active probing not implemented yet - value is stored but not enforced.',
            },
          ]}
          helpText="Active quality probing is a planned feature."
        />
      </div>

      <div className="mt-6">
        <FreeSwitchPanel carrierId={carrier.id} />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 text-xs max-w-4xl">
        <Detail
          label="ID"
          value={<span className="font-mono">{carrier.id}</span>}
        />
        <Detail
          label="Created"
          value={new Date(carrier.created_at).toLocaleString()}
        />
      </dl>

      {usedBy.length > 0 && (
        <div className="mt-6 border border-border rounded p-4 max-w-4xl">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
            Used by route plans ({usedBy.length})
          </h2>
          <ul className="space-y-1 text-sm">
            {usedBy.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/route-plans/${p.id}`}
                  className="hover:underline"
                >
                  {p.name}
                </Link>
                <span className="text-fg-subtle ml-2 text-xs">
                  {p.primary_carrier_id === carrier.id
                    ? '(primary)'
                    : '(failover)'}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-fg-subtle mt-3">
            Deletion is blocked while this carrier is referenced.
          </p>
        </div>
      )}

      <div className="mt-8 max-w-4xl flex items-center gap-4">
        <DeleteCarrierButton id={carrier.id} name={carrier.name} />
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="text-fg text-right">{value}</dd>
    </div>
  );
}
