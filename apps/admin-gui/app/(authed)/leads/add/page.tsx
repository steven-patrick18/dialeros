import { AddLeadListForm } from './add-form';

export default function AddLeadListPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">New Lead List</h1>
      <p className="text-fg-muted mb-6 text-sm max-w-xl">
        Create the list first, then upload your CSV from the list detail page.
      </p>
      <AddLeadListForm />
    </div>
  );
}
