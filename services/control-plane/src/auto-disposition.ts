/**
 * Iter 146 — Infer a system disposition for calls that no agent
 * is going to fill in manually.
 *
 * Before this module: every dial_intent that didn't pass through
 * an agent wrap-up screen sat at disposition=NULL forever —
 * machine drops, no-answers, originate errors, abandons. That
 * makes /supervisor/calls and the per-campaign report rows show
 * "—" for the vast majority of dispositions, drowning out the
 * actual sales/agent activity.
 *
 * inferAutoDisposition runs at CHANNEL_HANGUP_COMPLETE (see
 * fs-events.ts) and also via the
 * /api/internal/auto-dispose-backfill endpoint for historical
 * rows. It returns the disposition code to write, or null when
 * the row should be left alone (e.g. an agent will dispo it,
 * or it's already been dispositioned).
 *
 * Codes (matching ViciDial's conventional set where applicable
 * so existing report queries that look for these strings work):
 *   OE       Originate error — FS rejected the dial before ringing
 *   AM-VMD   Answering machine, voicemail message dropped
 *   AM-DROP  Answering machine, dropped without playback
 *             (amd_action=drop)
 *   AM       Answering machine, no specific action taken
 *   NA       No answer
 *   B        Busy
 *   CC       Call rejected / carrier blocked
 *   A        Abandoned — call answered but no agent on the bridge
 *             (no local seat available at originate time)
 *
 * Returns null when:
 *   - intent.disposition is already non-null (don't overwrite an
 *     agent's manual disposition)
 *   - the call answered AND an agent was assigned (let the
 *     wrap-up screen handle it — agents have N seconds to fill
 *     in the right code; auto would beat them to it)
 */

export interface AutoDispoIntent {
  disposition: string | null;
  originate_error: string | null;
  answered_at: string | null;
  assigned_user_id: string | null;
  hangup_cause: string | null;
  amd_result: string | null;
}

export interface AutoDispoCampaign {
  amd_action: string;
  voicemail_path: string | null;
}

export function inferAutoDisposition(
  intent: AutoDispoIntent,
  campaign?: AutoDispoCampaign | null,
): string | null {
  if (intent.disposition) return null;
  if (intent.originate_error) return 'OE';

  if (intent.amd_result === 'MACHINE') {
    if (campaign) {
      if (campaign.amd_action === 'voicemail' && campaign.voicemail_path) {
        return 'AM-VMD';
      }
      if (campaign.amd_action === 'detect' && campaign.voicemail_path) {
        return 'AM-VMD';
      }
      if (campaign.amd_action === 'drop') {
        return 'AM-DROP';
      }
    }
    return 'AM';
  }

  if (!intent.answered_at) {
    const cause = (intent.hangup_cause ?? '').toUpperCase();
    // FreeSWITCH Q.850 cause names. Group into the ViciDial buckets.
    if (
      cause === 'USER_BUSY' ||
      cause === 'BUSY'
    ) {
      return 'B';
    }
    if (
      cause === 'CALL_REJECTED' ||
      cause === 'NORMAL_TEMPORARY_FAILURE' ||
      cause === 'DESTINATION_OUT_OF_ORDER' ||
      cause === 'UNALLOCATED_NUMBER' ||
      cause === 'NORMAL_UNSPECIFIED'
    ) {
      return 'CC';
    }
    // NO_ANSWER, NO_USER_RESPONSE, ORIGINATOR_CANCEL,
    // NORMAL_CLEARING (no-answer + auto-clear), and unknown —
    // all map to NA for reporting purposes.
    return 'NA';
  }

  // Answered branches.
  if (!intent.assigned_user_id) {
    // Call answered with no local seat to bridge to — the bridge
    // resolved to &hangup (see pacing.ts computedBridgeTarget).
    // ViciDial calls these "abandoned"; max_abandon% caps how
    // often this is allowed before pacing throttles back.
    return 'A';
  }

  // Answered + agent assigned. Hand off to the wrap-up screen.
  return null;
}
