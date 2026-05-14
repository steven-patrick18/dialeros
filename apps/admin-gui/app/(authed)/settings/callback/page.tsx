import { redirect } from 'next/navigation';
import {
  getCallbackDtmfDigit,
  getCallbackEnabled,
  getCallbackTtlMinutes,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { CallbackEditor } from './editor';

export const dynamic = 'force-dynamic';

// Iter 178 — Inbound-to-outbound callback settings. Admin only.
// Three knobs:
//   1. Enable/disable (default off)
//   2. DTMF digit the caller presses to request a callback
//      (default '9')
//   3. TTL minutes — pending callbacks past this age get
//      auto-expired by the sweeper (default 60)

export default async function CallbackSettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">
          Inbound callback
        </h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const initial = {
    enabled: getCallbackEnabled(),
    digit: getCallbackDtmfDigit(),
    ttlMinutes: getCallbackTtlMinutes(),
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-1">
        Inbound callback (press-to-request)
      </h1>
      <p className="text-fg-subtle text-sm mb-6">
        When enabled, callers parked in an inbound hold queue can
        press the configured DTMF digit to request a callback
        instead of waiting. The system records the request,
        terminates the hold session, and (in a future iter) a
        worker originates an outbound leg when an agent on the
        same in-group becomes available. Supervisors see the
        pending list at <a href="/supervisor/callbacks"
        className="text-link hover:underline">/supervisor/callbacks</a>.
        Each caller is rate-limited to 3 requests per hour to
        prevent abuse.
      </p>
      <CallbackEditor initial={initial} />
    </div>
  );
}
