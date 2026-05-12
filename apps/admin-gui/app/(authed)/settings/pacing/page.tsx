import { redirect } from 'next/navigation';
import {
  getPacingThresholds,
  PACING_THRESHOLDS_DEFAULT,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { PacingThresholdsEditor } from './editor';

export const dynamic = 'force-dynamic';

// Iter 134 — predictive-pacing curve editor. Lets an admin tune
// the answer-rate → dial_level mapping that drives the
// recommendation card on every campaign page.

export default async function PacingSettings() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Pacing</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const steps = getPacingThresholds();
  const usingDefaults =
    JSON.stringify(steps) === JSON.stringify(PACING_THRESHOLDS_DEFAULT);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Pacing recommendation</h1>
      <p className="text-fg-muted text-sm mb-1 max-w-3xl">
        Tune the answer-rate → dial_level curve the recommendation
        card uses on every campaign&apos;s Real-Time tab. Each step
        is &ldquo;at this answer rate or higher, recommend this
        dial_level.&rdquo; Steps must be sorted DESC by min_rate
        and the lowest step must be min_rate = 0 (catch-all).
      </p>
      <p className="text-fg-subtle text-xs mb-6">
        {usingDefaults
          ? 'Currently using defaults — no override saved.'
          : 'Custom curve in effect — Reset reverts to defaults.'}
      </p>
      <PacingThresholdsEditor
        initial={steps}
        defaults={PACING_THRESHOLDS_DEFAULT}
      />
    </div>
  );
}
