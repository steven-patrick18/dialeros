import { redirect } from 'next/navigation';
import { getWrapupEnforcementEnabled } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { WrapupEnforcementToggle } from './toggle';

export const dynamic = 'force-dynamic';

// Iter 163 — Wrap-up enforcement settings page. Admin only.
// Single boolean toggle that controls whether the
// /api/agent/status endpoint blocks AVAILABLE transitions when
// the agent has an undispositioned connected call.

export default async function WrapupEnforcementPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">
          Wrap-up enforcement
        </h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const enabled = getWrapupEnforcementEnabled();

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-1">Wrap-up enforcement</h1>
      <p className="text-fg-subtle text-sm mb-6">
        When enabled, an agent who tries to flip themselves to
        AVAILABLE while they still have an undispositioned
        connected call gets a 409 from /api/agent/status — they
        stay PAUSED until they disposition the call. The pacer's
        idle-agent picker already skips PAUSED agents, so they
        won't get a new call shoved at them while they wrap up.
        Auto-dispositioned rows (iter-146: NA, B, OE, A, AM*)
        don&apos;t count — only answered_at-non-null rows that an
        agent personally is responsible for.
      </p>
      <WrapupEnforcementToggle initialEnabled={enabled} />
    </div>
  );
}
