import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  countCidsInGroup,
  getCarrier,
  getCidGroup,
  getRoutePlan,
  listCarriers,
  listCidGroups,
  parseCidGroupIds,
  parseCidPool,
  parseFailoverIds,
} from '@dialeros/control-plane';
import { AttachmentPicker } from '@/components/attachment-picker';
import { InlineCardForm } from '@/components/inline-card-form';
import { DeleteRoutePlanButton } from './delete-button';

export const dynamic = 'force-dynamic';

export default async function RoutePlanDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const plan = getRoutePlan(id);
  if (!plan) notFound();

  const primary = getCarrier(plan.primary_carrier_id);
  const failoverIds = parseFailoverIds(plan);
  const failovers = failoverIds.map((fid) => getCarrier(fid));
  const cidPool = parseCidPool(plan);
  const cidGroupIds = parseCidGroupIds(plan);
  const cidGroups = cidGroupIds.map((gid) => getCidGroup(gid)).filter(Boolean);
  const allCarriers = listCarriers();
  const allCidGroups = listCidGroups();

  const exampleNumber = '+14155551234';
  const transformed = applyTransform(
    exampleNumber,
    plan.transform_strip_prefix,
    plan.transform_add_prefix,
  );

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/route-plans"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          â† Route Plans
        </Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">{plan.name}</h1>
        {plan.enabled === 1 ? (
          <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
            ENABLED
          </span>
        ) : (
          <span className="bg-card-hover/40 text-fg-muted border border-border px-2 py-0.5 rounded text-xs">
            DISABLED
          </span>
        )}
      </div>
      <div className="max-w-4xl mb-6">
        <InlineCardForm
          title="Basics"
          endpoint={`/api/route-plans/${plan.id}`}
          fields={[
            {
              type: 'text',
              name: 'name',
              label: 'Name',
              value: plan.name,
              maxLength: 64,
              hint: 'Internal identifier. Letters, digits, dashes, underscores. Shown in campaign Route plan picker.',
            },
            {
              type: 'textarea',
              name: 'description',
              label: 'Description',
              value: plan.description,
              maxLength: 500,
              hint: 'Free-form notes. 500 chars max.',
            },
            {
              type: 'boolean',
              name: 'enabled',
              label: 'Enabled',
              value: plan.enabled === 1,
              hint: 'Disabling stops new dials from using this plan. Existing campaigns referencing it keep working until paused or moved.',
            },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
        <Card title="Primary carrier">
          {primary ? (
            <Link
              href={`/carriers/${primary.id}`}
              className="text-sm hover:underline"
            >
              {primary.name}
              <span className="text-fg-subtle ml-2 font-mono text-xs">
                {primary.host}:{primary.port}
              </span>
            </Link>
          ) : (
            <p className="text-error text-sm">
              Primary carrier missing â€” was it deleted?
            </p>
          )}
        </Card>

        <div className="border border-border rounded p-4 space-y-2">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
            Failover carriers ({failovers.length})
          </h2>
          <p className="text-xs text-fg-subtle mb-2">
            Tick the carriers to fall back to when the primary fails. Order
            in the list reflects priority. The primary is excluded — it
            can&apos;t also be a failover.
          </p>
          <AttachmentPicker
            endpoint={`/api/route-plans/${plan.id}`}
            bodyKey="failover_carrier_ids"
            method="PUT"
            options={allCarriers
              .filter((cc) => cc.id !== plan.primary_carrier_id)
              .map((cc) => ({
                id: cc.id,
                name: cc.name,
                hint: `${cc.transport}://${cc.host}:${cc.port}`,
                warn: cc.enabled === 0,
              }))}
            initialSelected={failoverIds}
          />
        </div>

        <InlineCardForm
          title="Caller ID"
          endpoint={`/api/route-plans/${plan.id}`}
          fields={[
            {
              type: 'select',
              name: 'cid_strategy',
              label: 'Strategy',
              value: plan.cid_strategy,
              options: [
                {
                  value: 'passthrough',
                  label: 'passthrough — use lead\'s assigned CID',
                },
                {
                  value: 'single',
                  label: 'single — always present one number',
                },
                {
                  value: 'rotate',
                  label: 'rotate — cycle through inline pool',
                },
                {
                  value: 'groups',
                  label: 'groups — pull from CID Groups (recommended)',
                },
              ],
              hint: 'How the outbound caller-ID is chosen. passthrough = whatever the lead row has; single = the cid_single field; rotate = cycle the inline cid_pool; groups = pull from reusable CID Groups with their own per-group logic.',
            },
            {
              type: 'text',
              name: 'cid_single',
              label: 'Single CID',
              value: plan.cid_single,
              placeholder: '+14155551234',
              hint: 'Used only when strategy is single. E.164 or digits.',
            },
            {
              type: 'lines',
              name: 'cid_pool',
              label: `CID pool (${cidPool.length} numbers)`,
              value: cidPool,
              placeholder: '+14155551234\n+14155551235',
              hint: 'One phone per line. Used only when strategy is rotate. Pacer cycles through this pool round-robin per campaign.',
            },
          ]}
        />

        <div className="border border-border rounded p-4 space-y-2">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
            CID Groups ({cidGroups.length})
          </h2>
          <p className="text-xs text-fg-subtle mb-2">
            Pick one or more reusable CID Groups. Only consulted when
            Strategy is <span className="font-mono">groups</span>. Pacer
            rotates across groups per call and then applies each
            group&apos;s own logic (rotate / random / sticky_by_area).
          </p>
          {allCidGroups.length === 0 ? (
            <p className="text-xs text-fg-subtle">
              No CID groups defined yet.{' '}
              <Link href="/cid-groups/add" className="underline">
                Create one
              </Link>{' '}
              first.
            </p>
          ) : (
            <AttachmentPicker
              endpoint={`/api/route-plans/${plan.id}`}
              bodyKey="cid_group_ids"
              method="PUT"
              options={allCidGroups.map((g) => ({
                id: g.id,
                name: g.name,
                hint: `${g.strategy} · ${countCidsInGroup(g.id)} CID${
                  countCidsInGroup(g.id) === 1 ? '' : 's'
                }`,
              }))}
              initialSelected={cidGroupIds}
            />
          )}
        </div>

        <InlineCardForm
          title="Number transform"
          endpoint={`/api/route-plans/${plan.id}`}
          fields={[
            {
              type: 'text',
              name: 'transform_strip_prefix',
              label: 'Strip prefix',
              value: plan.transform_strip_prefix,
              maxLength: 20,
              placeholder: '+1',
              hint: 'Removed from the start of the dialed number if present. Common: strip "+1" before sending to a domestic-only carrier.',
            },
            {
              type: 'text',
              name: 'transform_add_prefix',
              label: 'Add prefix',
              value: plan.transform_add_prefix,
              maxLength: 20,
              placeholder: '9',
              hint: 'Prepended to the dialed number after stripping. Common: add a "9" for outbound from a PBX, or "00" for international.',
            },
          ]}
          helpText={`Example: ${exampleNumber} → ${transformed}`}
        />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 text-xs max-w-4xl">
        <Detail label="ID" value={<span className="font-mono">{plan.id}</span>} />
        <Detail
          label="Created"
          value={new Date(plan.created_at).toLocaleString()}
        />
      </dl>

      <div className="mt-8 max-w-4xl flex items-center gap-4">
        <DeleteRoutePlanButton id={plan.id} name={plan.name} />
      </div>
    </div>
  );
}

function applyTransform(
  number: string,
  strip: string | null,
  add: string | null,
): string {
  let result = number;
  if (strip && result.startsWith(strip)) {
    result = result.slice(strip.length);
  }
  if (add) {
    result = add + result;
  }
  return result;
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded p-4 space-y-2">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
        {title}
      </h2>
      {children}
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
