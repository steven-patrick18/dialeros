// Iter 196 — Pure state derivation for supervisor AI monitoring.
// Given an ai_call_session row, decide what a supervisor can do
// with it. Kept pure so the gating logic is testable independent
// of ESL / DB.

export interface AiMonitorState {
  // Session loop is running (daemon driving STT→LLM→TTS).
  live: boolean;
  // Audio can be eavesdropped — needs a live FS channel.
  monitorable: boolean;
  // Caller can be yanked off the AI onto a human — same
  // requirement as monitor plus it must still be live (no point
  // seizing a completed/escalated session).
  seizable: boolean;
  reason: string;
}

export function aiSessionMonitorState(s: {
  status: string;
  call_uuid: string | null;
  ended_at: string | null;
}): AiMonitorState {
  const live = s.status === 'active' && s.ended_at == null;
  const hasChannel = !!s.call_uuid;
  if (!live) {
    return {
      live: false,
      monitorable: false,
      seizable: false,
      reason: `session ${s.status}`,
    };
  }
  if (!hasChannel) {
    // active but no call_uuid yet (race: WS metadata not posted)
    return {
      live: true,
      monitorable: false,
      seizable: false,
      reason: 'no call_uuid yet',
    };
  }
  return {
    live: true,
    monitorable: true,
    seizable: true,
    reason: 'ok',
  };
}
