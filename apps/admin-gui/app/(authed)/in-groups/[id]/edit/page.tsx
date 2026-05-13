import { notFound } from 'next/navigation';
import { getInGroup, parseStaticWhitelist } from '@dialeros/control-plane';
import { EditInGroupForm } from './edit-form';

export const dynamic = 'force-dynamic';

export default async function EditInGroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const g = getInGroup(id);
  if (!g) notFound();

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">
        Edit in-group: <span className="text-accent">{g.name}</span>
      </h1>
      <p className="text-fg-muted mb-6 text-sm max-w-xl">
        DIDs are managed from the detail page, not here.
      </p>
      <EditInGroupForm
        group={{
          id: g.id,
          name: g.name,
          description: g.description,
          type: g.type,
          whitelist_mode: g.whitelist_mode,
          whitelist_static: parseStaticWhitelist(g),
          routing_strategy: g.routing_strategy,
          max_wait_seconds: g.max_wait_seconds,
          wrap_up_seconds: g.wrap_up_seconds,
          off_list_action: g.off_list_action,
          enabled: g.enabled === 1,
          entry_call_menu_id: g.entry_call_menu_id ?? null,
          overflow_call_menu_id: g.overflow_call_menu_id ?? null,
          after_hours_call_menu_id: g.after_hours_call_menu_id ?? null,
        }}
      />
    </div>
  );
}
