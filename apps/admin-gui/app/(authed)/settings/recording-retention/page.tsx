import { redirect } from 'next/navigation';
import {
  getRecordingRetentionDays,
  getRecordingRetentionEnabled,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { RetentionForm } from './retention-form';

export const dynamic = 'force-dynamic';

// Iter 144 — admin-only page to configure the nightly recording
// prune job (dialeros-prune-recordings.timer, 03:30 daily).
//
// Two knobs:
//   - Retention days (1..3650). How old a .wav has to be before
//     it qualifies for deletion. Counted from file mtime.
//   - Enabled toggle. The timer still runs nightly even when off,
//     so changing this is enough — no systemctl needed. When
//     disabled the internal prune endpoint short-circuits and
//     does nothing.
//
// Plus a "Preview" button that runs the prune endpoint with
// dry_run=1 — scans + reports counts without deleting — and a
// "Prune now" button that runs it for real.
export default async function RecordingRetentionPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Recording retention</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const initial = {
    retention_days: getRecordingRetentionDays(),
    enabled: getRecordingRetentionEnabled(),
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-2">Recording retention</h1>
      <p className="text-fg-subtle text-sm mb-6">
        How long to keep call recordings on disk. The nightly prune
        job (dialeros-prune-recordings.timer) deletes .wav files
        older than the retention window and NULLs the matching
        dial_intent rows&apos; recording_path so the play/download
        buttons disappear. Off by default — toggle on once you&apos;ve
        confirmed the cutoff is what you want with the Preview
        button below.
      </p>
      <RetentionForm initial={initial} />
    </div>
  );
}
