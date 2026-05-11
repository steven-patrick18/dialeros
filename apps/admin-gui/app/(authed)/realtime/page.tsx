import { redirect } from 'next/navigation';
import {
  listActiveCalls,
  liveAgentSnapshot,
  liveCampaignSnapshot,
  remoteLineCapacity,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { SoftphoneProvider } from '@/components/softphone';
import { RealtimeBoard } from './board';

export const dynamic = 'force-dynamic';

export default async function RealtimePage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Real-time</h1>
        <p className="text-error text-sm">Admin or supervisor role required.</p>
      </div>
    );
  }
  const initial = {
    generated_at: new Date().toISOString(),
    remote_line_capacity: remoteLineCapacity(),
    campaigns: liveCampaignSnapshot(),
    agents: liveAgentSnapshot(),
    active_calls: listActiveCalls(),
  };

  return (
    <SoftphoneProvider>
      <div>
        <h1 className="text-2xl font-semibold mb-1">Real-time</h1>
        <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
          Live floor view of every active campaign, every signed-in
          agent, and every bridged call. Refreshes every 2 seconds.
          Eavesdrop controls work from the live-calls table — your own
          softphone (registered for this session) answers the
          monitor / whisper / barge leg.
        </p>
        <RealtimeBoard initial={initial} />
      </div>
    </SoftphoneProvider>
  );
}
