import { redirect } from 'next/navigation';
import {
  getFreqCapEnabled,
  getFreqCapLeadCount,
  getFreqCapLeadWindowHours,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { FrequencyCapsForm } from './form';

export const dynamic = 'force-dynamic';

export default async function FrequencyCapsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Frequency caps (TCPA)</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const initial = {
    enabled: getFreqCapEnabled(),
    lead_count: getFreqCapLeadCount(),
    lead_window_hours: getFreqCapLeadWindowHours(),
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-1">
        Frequency caps (TCPA)
      </h1>
      <p className="text-fg-subtle text-sm mb-6">
        Per-lead pre-dial guard: don&apos;t dial the same phone more
        than N times in a rolling W-hour window. Pacer checks the
        cap on every tick before originating; over-cap rows get a{' '}
        <code className="text-xs">freq_cap.lead_skipped</code>{' '}
        audit_events row + console warn instead of a dial. Default
        OFF — existing deployments behave unchanged until the
        admin opts in.
      </p>
      <p className="text-fg-subtle text-xs mb-6">
        FCC-conservative defaults: 3 calls / 24h. Tighter
        operators (e.g. survey houses with strict client SLAs)
        often use 1 / 48h. Looser pure-outbound sales floors run
        5-7 / 24h. The iter-147 abandon-rate guardrail still
        applies independently.
      </p>
      <FrequencyCapsForm initial={initial} />
    </div>
  );
}
