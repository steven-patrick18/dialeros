import { redirect } from 'next/navigation';
import {
  carrierLiveSnapshot,
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
  // Iter 85 — JSON roundtrip strips the null-prototype that
  // node:sqlite hands back on row objects. Without it, React 19 RSC
  // refuses to serialize the snapshot to the RealtimeBoard client
  // component and the page renders a digest error.
  const initial = JSON.parse(
    JSON.stringify({
      generated_at: new Date().toISOString(),
      remote_line_capacity: remoteLineCapacity(),
      campaigns: liveCampaignSnapshot(),
      agents: liveAgentSnapshot(),
      active_calls: listActiveCalls(),
      carriers: carrierLiveSnapshot(),
    }),
  );

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
