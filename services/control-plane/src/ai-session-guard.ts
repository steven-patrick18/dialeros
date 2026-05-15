// Iter 190 — AI session guardrail logic. Pure decision function:
// given the persona's limits + the current session state + the
// latest caller utterance, decide whether the loop should
// continue, escalate to a human, or end.
//
// Shared by:
//   - iter 191's conversational loop (called after every caller
//     turn, before generating the AI reply)
//   - iter 192's AI↔human transfer (escalate → transfer path)
//   - the media-bridge daemon's session lifecycle
//
// No I/O — trivially unit-testable, which matters because this
// is the safety boundary: a bug here means an AI agent that
// won't hand off to a human or won't ever hang up.

export interface SessionGuardState {
  // Number of completed caller turns so far (this turn included).
  caller_turns: number;
  // Seconds since the session started.
  elapsed_seconds: number;
  // The caller's latest transcribed utterance (lowercased match).
  last_caller_text: string;
}

export interface SessionGuardLimits {
  max_turns: number;
  max_call_seconds: number;
  escalation_keywords: string[];
}

export type GuardDecision =
  | { action: 'continue' }
  | {
      action: 'escalate';
      reason: 'keyword';
      matched: string;
    }
  | {
      action: 'end';
      reason: 'max_turns' | 'max_call_seconds';
    };

/** Normalize a caller utterance for keyword matching: lowercase,
 * collapse internal whitespace, strip surrounding punctuation.
 * Exported so the loop + tests share exactly one normalizer. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escalation keyword match is substring-on-word-boundaries:
 * "lawyer" matches "i want a lawyer" but a keyword "human"
 * does NOT match "humane". Multi-word keywords ("speak to a
 * person") match as a contiguous phrase. */
export function matchesEscalationKeyword(
  text: string,
  keywords: string[],
): string | null {
  const hay = normalizeForMatch(text);
  if (!hay) return null;
  for (const kw of keywords) {
    const needle = normalizeForMatch(kw);
    if (!needle) continue;
    // Word-boundary regex; needle may contain spaces (phrase).
    const re = new RegExp(
      `(^|\\s)${needle.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(\\s|$)`,
    );
    if (re.test(hay)) return kw;
  }
  return null;
}

/** Evaluate AFTER a caller turn is transcribed, BEFORE the AI
 * reply is generated. Precedence: escalation keyword (caller
 * explicitly asked) > hard limits. Escalation wins over an
 * also-hit max_turns because honoring "I want a human" is more
 * important than a clean turn-count exit. */
export function evaluateSessionGuard(
  state: SessionGuardState,
  limits: SessionGuardLimits,
): GuardDecision {
  const kw = matchesEscalationKeyword(
    state.last_caller_text,
    limits.escalation_keywords,
  );
  if (kw) {
    return { action: 'escalate', reason: 'keyword', matched: kw };
  }
  if (state.elapsed_seconds >= limits.max_call_seconds) {
    return { action: 'end', reason: 'max_call_seconds' };
  }
  if (state.caller_turns >= limits.max_turns) {
    return { action: 'end', reason: 'max_turns' };
  }
  return { action: 'continue' };
}
