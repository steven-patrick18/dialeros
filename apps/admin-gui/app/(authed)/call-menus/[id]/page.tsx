import { redirect, notFound } from 'next/navigation';
import {
  getCallMenu,
  getCallMenuOptions,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { CallMenuForm } from '../menu-form';
import { CallMenuAnalyticsCard } from '../analytics-card';

export const dynamic = 'force-dynamic';

export default async function EditCallMenuPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Call Menu</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const { id } = await params;
  const menu = getCallMenu(id);
  if (!menu) notFound();
  const options = getCallMenuOptions(id);

  const initialData = {
    name: menu.name,
    description: menu.description ?? '',
    prompt_tts_text: menu.prompt_tts_text ?? '',
    prompt_path: menu.prompt_path ?? '',
    timeout_seconds: menu.timeout_seconds,
    max_retries: menu.max_retries,
    invalid_audio_path: menu.invalid_audio_path ?? '',
    timeout_audio_path: menu.timeout_audio_path ?? '',
    default_action_type: menu.default_action_type,
    default_action_value: menu.default_action_value ?? '',
    options: options.map((o, idx) => ({
      digit: o.digit,
      label: o.label ?? '',
      action_type: o.action_type,
      action_value: o.action_value ?? '',
      ordering: o.ordering ?? idx,
      dispo_code: o.dispo_code ?? '',
      tod_start: o.tod_start ?? '',
      tod_end: o.tod_end ?? '',
    })),
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">
        Call Menu — {menu.name}
      </h1>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        {menu.description || 'No description.'}
      </p>
      <CallMenuForm initialData={initialData} menuId={id} />
      <CallMenuAnalyticsCard menuId={id} />
    </div>
  );
}
