import { redirect } from 'next/navigation';
import {
  listActiveCalls,
  listActiveQueuedCalls,
  listRecentInboundDecisions,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { SupervisorBoard } from './board';
import { InboundMonitor } from './inbound-monitor';
import { QueuedCalls } from './queued-calls';
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
  // Iter 115 — recent inbound decisions for the new monitor card.
  // JSON-roundtripped because node:sqlite returns null-prototype
  // rows that React 19 RSC refuses to serialize (iter 85 dance).
  const inboundDecisions = JSON.parse(
    JSON.stringify(listRecentInboundDecisions(50)),
  );
  const queuedCalls = JSON.parse(JSON.stringify(listActiveQueuedCalls()));

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

        <QueuedCalls initial={queuedCalls} />
        <InboundMonitor initial={inboundDecisions} />
      </div>
    </SoftphoneProvider>
  );
}
