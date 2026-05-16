// Iter 203 — Inbound ACD agent-resolution policy. Pure decision
// so the precedence is testable independent of DB/ESL.
//
// An AI-agent user is assigned to an in-group exactly like a
// human (user_in_groups). The queue resolves a waiting caller:
//   1. a live HUMAN agent wins (AI is overflow, never preempts
//      a real person who's free)
//   2. else, if an enabled AI agent is assigned AND the master
//      live switch (ai.live_enabled, iter 195) is ON → AI
//   3. else hold (keep MOH; poll again)
//
// AI is deliberately NOT capacity-gated like a human — one
// persona can field many concurrent callers.

export type QueueRoute = 'human' | 'ai' | 'hold';

export function resolveQueueRoute(args: {
  humanAvailable: boolean;
  aiAssigned: boolean;
  aiLiveEnabled: boolean;
}): QueueRoute {
  if (args.humanAvailable) return 'human';
  if (args.aiAssigned && args.aiLiveEnabled) return 'ai';
  return 'hold';
}
