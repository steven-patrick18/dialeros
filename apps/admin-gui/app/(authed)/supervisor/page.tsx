import { redirect } from 'next/navigation';
import { listActiveCalls } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { SupervisorBoard } from './board';
import { SoftphoneProvider } from '@/components/softphone';

export const dynamic = 'force-dynamic';

export default async function SupervisorPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Supervisor</h1>
        <p className="text-error text-sm">Admin or supervisor role required.</p>
      </div>
    );
  }

  const initial = listActiveCalls();

  return (
    <SoftphoneProvider>
      <div>
        <h1 className="text-2xl font-semibold mb-1">Supervisor floor</h1>
        <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
          Every live, bridged call across every campaign. Pick a row to
          monitor (silent listen), whisper (talk to the agent only), or
          barge (3-way). Your softphone above answers the eavesdrop leg
          automatically — make sure it shows REG before you click.
        </p>
        <SupervisorBoard
          initial={initial.map((c) => ({
            id: c.id,
            ts: c.ts,
            campaign_name: c.campaign_name,
            user_username: c.user_username,
            phone: c.phone,
            transformed_phone: c.transformed_phone,
            call_uuid: c.call_uuid,
            answered_at: c.answered_at,
          }))}
        />
      </div>
    </SoftphoneProvider>
  );
}
