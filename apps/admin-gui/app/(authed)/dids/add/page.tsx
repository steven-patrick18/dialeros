import Link from 'next/link';
import { listAllDids, listInGroups } from '@dialeros/control-plane';
import { AddDidForm } from './add-form';

export const dynamic = 'force-dynamic';

export default async function AddDidsPage() {
  const inGroups = listInGroups();
  const allDids = listAllDids();

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/dids"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          ← DIDs
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-1">Add DIDs</h1>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        Add one phone number, paste a list to bulk-add, or clone an
        existing DID&apos;s settings to a new number.
      </p>

      <AddDidForm
        inGroups={inGroups.map((g) => ({
          id: g.id,
          name: g.name,
          enabled: g.enabled === 1,
        }))}
        existingDids={allDids.map((d) => d.did)}
      />
    </div>
  );
}
