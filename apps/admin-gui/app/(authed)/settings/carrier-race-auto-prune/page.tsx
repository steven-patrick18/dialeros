import { redirect } from 'next/navigation';
import {
  getCarrierRaceAutoPruneConfig,
  listPausedRaceCarriers,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { AutoPruneEditor } from './editor';

export const dynamic = 'force-dynamic';

// Iter 187 — Adaptive carrier race auto-prune settings. Reads
// iter-186's race-winner data to find carriers that consistently
// lose; sets race_paused_until on them so the parallel-race
// picker skips them temporarily.

export default async function CarrierRaceAutoPrunePage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">
          Race auto-prune
        </h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }
  const cfg = getCarrierRaceAutoPruneConfig();
  const paused = JSON.parse(
    JSON.stringify(listPausedRaceCarriers()),
  ) as ReturnType<typeof listPausedRaceCarriers>;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-1">Race auto-prune</h1>
      <p className="text-fg-subtle text-sm mb-6">
        When enabled, the system periodically reviews each
        carrier&apos;s parallel-race performance (iter 183 + 186
        data) and pauses carriers that consistently lose races or
        deliver slow PDD. Paused carriers are excluded from race
        participation but still work for single-leg dials. Paused
        carriers automatically resume after the cooldown period.
      </p>
      <AutoPruneEditor initial={cfg} pausedRows={paused} />
    </div>
  );
}
