import { AddInGroupForm } from './add-form';

export default function AddInGroupPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">New In-Group</h1>
      <p className="text-fg-muted mb-6 text-sm max-w-xl">
        Configure routing + whitelist. After creating, attach DIDs from the
        detail page.
      </p>
      <AddInGroupForm />
    </div>
  );
}
