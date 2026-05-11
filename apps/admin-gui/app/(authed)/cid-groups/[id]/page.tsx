import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  countCidsInGroup,
  getCidGroup,
  listCidsInGroup,
  listRoutePlansUsingCidGroup,
} from '@dialeros/control-plane';
import { InlineCardForm } from '@/components/inline-card-form';
import { BulkAddCids } from './bulk-add';
import { CidRow } from './cid-row';
import { DeleteGroupButton } from './delete-button';

export const dynamic = 'force-dynamic';

export default async function CidGroupDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const group = getCidGroup(id);
  if (!group) notFound();

  const numbers = listCidsInGroup(group.id);
  const count = countCidsInGroup(group.id);
  const usedBy = listRoutePlansUsingCidGroup(group.id);

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/cid-groups"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          ← CID Groups
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-1">{group.name}</h1>
      <p className="text-fg-subtle text-sm mb-4">
        {count.toLocaleString()} number{count === 1 ? '' : 's'} ·{' '}
        <span className="font-mono">{group.strategy}</span>
      </p>

      <div className="max-w-4xl mb-6">
        <InlineCardForm
          title="Identity"
          endpoint={`/api/cid-groups/${group.id}`}
          layout="rows"
          fields={[
            {
              type: 'text',
              name: 'name',
              label: 'Name',
              value: group.name,
              maxLength: 64,
              hint: 'Alphanumeric, dashes, underscores. Shown in route-plan picker.',
            },
            {
              type: 'text',
              name: 'description',
              label: 'Description',
              value: group.description,
              maxLength: 500,
              hint: 'Optional notes about what these numbers are for.',
            },
            {
              type: 'select',
              name: 'strategy',
              label: 'Per-call logic',
              value: group.strategy,
              options: [
                {
                  value: 'rotate',
                  label: 'rotate — round-robin every call',
                },
                {
                  value: 'random',
                  label: 'random — pick at random every call',
                },
                {
                  value: 'sticky_by_area',
                  label:
                    'sticky_by_area — match lead area code, fall back to rotate',
                },
              ],
              hint: 'sticky_by_area picks the first attached number whose first 3 digits (post-country-code) match the lead. Falls back to rotate when no match.',
            },
          ]}
        />
      </div>

      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Add numbers
        </h2>
        <p className="text-xs text-fg-subtle mb-3">
          Paste numbers separated by newlines, commas, or whitespace.
          Formatting characters ((), -, ., spaces) are stripped. Duplicates
          inside this group are silently ignored.
        </p>
        <BulkAddCids groupId={group.id} />
      </div>

      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Numbers ({numbers.length})
        </h2>
        {numbers.length === 0 ? (
          <p className="text-fg-subtle text-sm">
            None yet. Add some above.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {numbers.map((n) => (
              <CidRow
                key={n.id}
                groupId={group.id}
                numberId={n.id}
                number={n.number}
                addedAt={n.created_at}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Used by ({usedBy.length} route plan
          {usedBy.length === 1 ? '' : 's'})
        </h2>
        {usedBy.length === 0 ? (
          <p className="text-fg-subtle text-sm">
            Not yet attached to any route plan. Open a route plan and pick
            this group from the CID group picker.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {usedBy.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/route-plans/${p.id}`}
                  className="hover:underline"
                >
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DeleteGroupButton id={group.id} name={group.name} inUse={usedBy.length > 0} />
    </div>
  );
}
