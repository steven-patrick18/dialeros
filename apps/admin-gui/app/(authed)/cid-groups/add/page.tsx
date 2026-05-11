import { AddCidGroupForm } from './add-form';

export const dynamic = 'force-dynamic';

export default function AddCidGroupPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">Add CID Group</h1>
      <p className="text-fg-muted mb-6 text-sm max-w-xl">
        Pick a name and rotation strategy. After saving you can bulk-paste
        numbers on the detail page.
      </p>
      <AddCidGroupForm />
    </div>
  );
}
