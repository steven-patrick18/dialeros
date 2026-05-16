// Iter 195 — Pure decision: should this campaign's answered leg
// be handed to the AI agent instead of bridged to a human?
//
// The safety boundary for going live. Routing to AI replaces
// the agent bridge, so the gate is deliberately strict:
//
//   1. ai.live_enabled        — master operator switch (default
//                               OFF; flipped only after
//                               install-audio-fork.sh compiles
//                               mod_audio_stream)
//   2. campaign.ai_persona_id — a persona is bound
//   3. persona.enabled        — the persona is turned on
//   4. amd_action is the conversational path — 'bridge' or ''
//      (default). Drop modes (voicemail / audio_drop / drop)
//      and the detection/menu paths are NOT conversational; AI
//      only ever replaces a live-agent bridge, never a
//      pre-recorded drop.
//
// Any condition false → false → pacer takes its normal path →
// zero behaviour change for every existing campaign.

export interface AiRoutingInput {
  liveEnabled: boolean;
  aiPersonaId: string | null | undefined;
  personaEnabled: boolean;
  amdAction: string;
}

const CONVERSATIONAL_AMD = new Set(['', 'bridge']);

export function shouldRouteCallToAi(i: AiRoutingInput): boolean {
  if (!i.liveEnabled) return false;
  if (!i.aiPersonaId) return false;
  if (!i.personaEnabled) return false;
  if (!CONVERSATIONAL_AMD.has(i.amdAction ?? '')) return false;
  return true;
}
