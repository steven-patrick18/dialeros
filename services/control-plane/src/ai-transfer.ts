// Iter 205 — learn-when-to-transfer. The Master observes calls
// that left the AI for a human (status='escalated') and turns
// the caller's pre-handoff line into a reusable, embeddable
// transfer_rule. On a LATER call the Worker semantically matches
// the caller against those learned triggers and proactively
// hands off — catching the PARAPHRASES the static escalation-
// keyword list (iter 190) can never enumerate.
//
// Pure half only (gate + signal text + decision). Embedding +
// ai_memory I/O live in ai-memory.ts / db.ts (same split as
// ai-rag.ts). The decision is a SAFETY boundary — a false
// positive rips a caller away from a working AI mid-sentence —
// so it is exhaustively tested.

export interface TransferRuleHit {
  reason: string;
  score: number;
}

export type TransferDecision =
  | { transfer: false }
  | { transfer: true; reason: string; score: number };

/** Cosine threshold for a LEARNED transfer. Deliberately high:
 * a false positive yanks a caller off a working AI, which is
 * worse than a missed paraphrase (hard limits + the operator's
 * keyword list still backstop). Tunable; starts conservative. */
export const TRANSFER_MIN_SCORE = 0.62;

/** Decide from similarity-ranked transfer_rule hits (already
 * sorted desc by the caller). Transfer only if the BEST hit
 * clears minScore. Pure + total — never throws. */
export function resolveTransfer(
  hits: TransferRuleHit[],
  minScore: number = TRANSFER_MIN_SCORE,
): TransferDecision {
  if (!Array.isArray(hits) || hits.length === 0) {
    return { transfer: false };
  }
  const best = hits[0];
  if (
    !best ||
    typeof best.score !== 'number' ||
    !Number.isFinite(best.score) ||
    best.score < minScore
  ) {
    return { transfer: false };
  }
  const reason =
    typeof best.reason === 'string' && best.reason.trim()
      ? best.reason.trim()
      : 'learned';
  return { transfer: true, reason, score: best.score };
}

/** The trigger text to embed from an escalated call: the LAST
 * caller utterance before the hand-off (the line that "asked"
 * for a human / another desk). A terse final line ("yes",
 * "please") is a weak signal — fall back to the last few caller
 * lines for context. '' when there is no usable caller speech. */
export function buildTransferSignalText(
  turns: Array<{ role: string; text: string }>,
  maxChars = 400,
): string {
  if (!Array.isArray(turns)) return '';
  const callerLines = turns
    .filter(
      (t) =>
        t &&
        t.role === 'caller' &&
        typeof t.text === 'string' &&
        t.text.trim() !== '',
    )
    .map((t) => t.text.trim());
  if (callerLines.length === 0) return '';
  const max =
    Number.isInteger(maxChars) && maxChars > 0 ? maxChars : 400;
  const last = callerLines[callerLines.length - 1] ?? '';
  let text = last;
  if (last.length < 25 && callerLines.length > 1) {
    text = callerLines.slice(-3).join(' ');
  }
  return text.length > max ? text.slice(0, max) : text;
}

/** Gate: is this ended session worth mining into a transfer
 * rule? Only escalated sessions (a human WAS needed), not
 * already mined, with a substantive caller signal. Pure. */
export function shouldLearnTransferRule(args: {
  status: string;
  alreadyMined: boolean;
  signalText: string;
}): boolean {
  if (args.alreadyMined) return false;
  if (args.status !== 'escalated') return false;
  return (
    typeof args.signalText === 'string' &&
    args.signalText.trim().length >= 8
  );
}
