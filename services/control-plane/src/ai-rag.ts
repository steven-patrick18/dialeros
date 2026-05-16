// Iter 204 — RAG retrieval assembly + exemplar curation. Pure,
// deterministic, exhaustively tested. The I/O halves (embed,
// db) live in ai-memory.ts / db.ts; this module only SHAPES
// text, so the prompt the operator tunes == the prompt the
// agent speaks on a call (same drift-avoidance discipline as
// ai-conversation.ts).

export interface RetrievalHit {
  title: string;
  content: string;
  score: number;
}

/** Render ranked memory hits into ONE system-message block the
 * Worker prompt injects just after identity/behaviour. Returns
 * '' when there are no usable hits (caller then injects nothing
 * — zero behaviour change when the store is empty / nothing
 * matched). Hard char cap so a big knowledge base can't blow a
 * 3B model's context: WHOLE hits are dropped once the budget is
 * spent (never a fact truncated mid-sentence). */
export function buildRetrievalBlock(
  hits: RetrievalHit[],
  maxChars = 1200,
): string {
  if (!Array.isArray(hits) || hits.length === 0) return '';
  const max =
    Number.isInteger(maxChars) && maxChars > 0 ? maxChars : 1200;
  const header =
    'RELEVANT KNOWLEDGE - use silently to answer accurately. ' +
    'Never mention these notes, that you looked anything up, ' +
    'or that you are an AI:';
  const lines: string[] = [];
  let used = header.length;
  for (const h of hits) {
    const title = typeof h?.title === 'string' ? h.title.trim() : '';
    const content =
      typeof h?.content === 'string' ? h.content.trim() : '';
    if (!content) continue;
    const line = title ? `- ${title}: ${content}` : `- ${content}`;
    if (used + line.length + 1 > max) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 0) return '';
  return `${header}\n${lines.join('\n')}`;
}

/** Flatten a finished call's turns into a compact labelled
 * transcript for embedding + storage as a reusable exemplar.
 * Returns '' unless the call has a real exchange (>=1 caller
 * AND >=1 ai turn) — half-calls aren't worth learning from.
 * maxChars caps the stored text; OLDEST turns are dropped first
 * so the resolution / close (the valuable part) is always kept.
 * A single turn already over budget is hard-cut, not lost. */
export function buildExemplarFromTurns(
  turns: Array<{ role: string; text: string }>,
  maxChars = 1500,
): string {
  if (!Array.isArray(turns)) return '';
  const clean = turns.filter(
    (t) =>
      t &&
      (t.role === 'caller' || t.role === 'ai') &&
      typeof t.text === 'string' &&
      t.text.trim() !== '',
  );
  if (
    !clean.some((t) => t.role === 'caller') ||
    !clean.some((t) => t.role === 'ai')
  ) {
    return '';
  }
  const max =
    Number.isInteger(maxChars) && maxChars > 0 ? maxChars : 1500;
  const lines = clean.map(
    (t) =>
      `${t.role === 'caller' ? 'Caller' : 'Agent'}: ${t.text.trim()}`,
  );
  // Walk newest -> oldest so the close/resolution is always
  // kept; stop as soon as adding an older turn would overflow.
  const rev = [...lines].reverse();
  let out = '';
  for (const ln of rev) {
    const next = out ? `${ln}\n${out}` : ln;
    if (next.length > max) break;
    out = next;
  }
  if (!out && rev.length > 0) {
    out = (rev[0] ?? '').slice(0, max);
  }
  return out;
}

/** QA score (0-100, iter-197 scale) at/above which a finished
 * call is worth promoting into the reusable exemplar store. A
 * deliberately high bar — an exemplar steers EVERY future call
 * in scope, so only near-perfect calls qualify. */
export const EXEMPLAR_MIN_SCORE = 85;

/** Gate for auto-promoting a graded session into ai_memory.
 * True only for a finite score >= minScore that hasn't already
 * been promoted (idempotent — the QA sweep is re-entrant). */
export function shouldPromoteExemplar(
  score: number | null | undefined,
  alreadyPromoted: boolean,
  minScore: number = EXEMPLAR_MIN_SCORE,
): boolean {
  if (alreadyPromoted) return false;
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return false;
  }
  return score >= minScore;
}
