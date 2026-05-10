/**
 * Iter 34 — map a FreeSWITCH hangup result to a lead status.
 *
 * The pacer marks a lead 'DIALING' when it places a live originate.
 * Once FreeSWITCH reports the call ended, fs-events looks at the
 * hangup_cause + answered_at and decides what the lead's status
 * should be next:
 *
 *   - Connected (NORMAL_CLEARING with answered_at)
 *       → 'CALLED_ANSWERED'  (a human picked up; an agent will
 *         disposition manually on top of this — disposition wins)
 *   - Busy
 *       → 'BUSY'             (retry-later, treated as dialable)
 *   - No answer / timeout
 *       → 'CALLED_NO_ANSWER' (existing dialable status)
 *   - Bad number / unallocated / out of order
 *       → 'BAD_NUMBER'       (terminal; pacer skips)
 *   - Carrier-side / system rejections
 *       → 'CALLED_NO_ANSWER' (treat as transient; retry)
 *   - We hung up before far end (ORIGINATOR_CANCEL, MANAGER_REQUEST)
 *       → null               (don't touch — admin canceled, status
 *         stays whatever it was)
 *
 * The fs-events caller is responsible for ONLY applying the new
 * status when the lead is currently in DIALING. If it's already moved
 * to a disposition (CONVERTED, DNC, etc.) — because the agent
 * dispositioned before hangup — we don't overwrite.
 */
export function leadStatusFromHangup(args: {
  hangupCause: string;
  answeredAt: string | null;
}): string | null {
  const c = args.hangupCause.toUpperCase();
  const answered = !!args.answeredAt;

  // Categorize
  switch (c) {
    case 'NORMAL_CLEARING':
      // Far end or we hung up cleanly. Only meaningful if the call
      // was actually answered. Otherwise treat like NO_ANSWER.
      return answered ? 'CALLED_ANSWERED' : 'CALLED_NO_ANSWER';

    case 'USER_BUSY':
      return 'BUSY';

    case 'NO_USER_RESPONSE':
    case 'NO_ANSWER':
    case 'ALLOTTED_TIMEOUT':
    case 'PROGRESS_TIMEOUT':
    case 'MEDIA_TIMEOUT':
      return 'CALLED_NO_ANSWER';

    case 'DESTINATION_OUT_OF_ORDER':
    case 'UNALLOCATED_NUMBER':
    case 'NO_ROUTE_DESTINATION':
    case 'NO_ROUTE_TRANSIT_NET':
    case 'INVALID_NUMBER_FORMAT':
    case 'NUMBER_CHANGED':
      return 'BAD_NUMBER';

    case 'CALL_REJECTED':
    case 'INCOMPATIBLE_DESTINATION':
      return 'REJECTED';

    case 'NETWORK_OUT_OF_ORDER':
    case 'NORMAL_TEMPORARY_FAILURE':
    case 'SWITCH_CONGESTION':
    case 'GATEWAY_DOWN':
    case 'NO_ROUTE_AVAILABLE':
    case 'USER_NOT_REGISTERED':
      // Carrier-side transient; lead is fine, retry later.
      return 'CALLED_NO_ANSWER';

    // We initiated the hangup — originate_timeout, admin pause, or
    // fsctl hupall. The lead never resolved one way or the other, so
    // treat it like a no-answer and let the cooldown gate the next
    // dial. The IN_FLIGHT guard in fs-events still prevents trampling
    // agent-set statuses (CONVERTED, DNC, etc.) — those leads are no
    // longer DIALING by the time we get the hangup event.
    case 'ORIGINATOR_CANCEL':
    case 'MANAGER_REQUEST':
      return 'CALLED_NO_ANSWER';

    // Mid-call transfer artifacts — the call legs continue, just on
    // a different bridge. The lead's outcome is determined by the
    // post-transfer leg's eventual hangup, not this synthetic event.
    case 'BLIND_TRANSFER':
    case 'ATTENDED_TRANSFER':
      return null;

    default:
      // Conservative: treat unknown as a no-answer-ish failure so the
      // lead returns to the dialable pool. If we see new causes
      // frequently in journals, add explicit cases above.
      return answered ? 'CALLED_ANSWERED' : 'CALLED_NO_ANSWER';
  }
}

/** Statuses considered "in flight" — the call hasn't resolved yet. */
export const IN_FLIGHT_STATUSES = new Set(['DIALING']);

/**
 * Statuses considered terminal — fs-events should never overwrite them
 * (an agent dispositioned the lead, or it's been DNC'd, etc.).
 */
export const TERMINAL_STATUSES = new Set([
  'CONVERTED',
  'DNC',
  'DEAD',
  'BAD_NUMBER',
  'REJECTED',
  'CALLBACK_SCHEDULED',
]);
