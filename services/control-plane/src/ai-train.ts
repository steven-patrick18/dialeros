// Iter 211 — Master AI Training Center. The operator trains the
// Master from four sources — typed knowledge, an uploaded audio
// file (whisper-transcribed), a real ended AI call session, and
// a self-interview where the Master asks the operator questions.
// Every mode funnels into the SAME RAG pipeline (chunk -> embed
// -> scoped ai_memory) the Worker already retrieves (iter 204),
// so training takes effect on the next call with zero new
// machinery.
//
// Pure half only: the interview prompt + the defensive parse of
// the LLM's question list + the Q&A / source / title shaping.
// I/O (whisper, embed, insert) lives in the routes.

export const TRAINING_KIND = 'knowledge';
export const TRAINING_MAX_TITLE = 120;
export const INTERVIEW_MAX_Q = 12;

export type TrainMode = 'text' | 'audio' | 'call' | 'interview';

/** Provenance tag stored on the ai_memory row so the operator
 * can see (and the auto-curators can avoid double-counting)
 * where a memory came from. Ref is sanitized to a safe slug. */
export function trainingSource(mode: TrainMode, ref?: string): string {
  const r = (typeof ref === 'string' ? ref : '')
    .replace(/[^\w.\-:@]/g, '')
    .slice(0, 80);
  return r ? `train:${mode}:${r}` : `train:${mode}`;
}

/** Safe display/slug form of an uploaded filename (strip any
 * path, drop unusual chars, cap length). Never empty. */
export function sanitizeUploadName(name: unknown): string {
  if (typeof name !== 'string' || !name) return 'audio';
  const base = name.split(/[\\/]/).pop() ?? 'audio';
  const clean = base.replace(/[^\w.\- ]/g, '').trim().slice(0, 80);
  return clean || 'audio';
}

/** A stable, bounded title for a stored training memory. */
export function trainingTitle(mode: TrainMode, hint?: string): string {
  const label =
    mode === 'audio'
      ? 'Audio training'
      : mode === 'call'
        ? 'Call training'
        : mode === 'interview'
          ? 'Interview answer'
          : 'Training note';
  const h =
    typeof hint === 'string'
      ? hint.trim().replace(/\s+/g, ' ').slice(0, TRAINING_MAX_TITLE)
      : '';
  return h ? `${label}: ${h}` : label;
}

/** Build the prompt that makes the Master interview the
 * operator. It asks short, specific, NON-overlapping questions
 * (skips topics already in memory) whose answers materially
 * improve real-call handling. Pure + deterministic. */
export function buildInterviewPrompt(
  scopeLabel: string,
  knownTitles: string[],
  n: number,
): string {
  const cap =
    Number.isInteger(n) && n > 0 ? Math.min(n, INTERVIEW_MAX_Q) : 6;
  const area =
    typeof scopeLabel === 'string' && scopeLabel.trim()
      ? scopeLabel.trim()
      : 'general customer support';
  const known = (Array.isArray(knownTitles) ? knownTitles : [])
    .filter((t) => typeof t === 'string' && t.trim())
    .slice(0, 40)
    .map((t) => `- ${t.trim()}`)
    .join('\n');
  return [
    `You are interviewing a human supervisor to TRAIN a phone ` +
      `support agent that works in this area: ${area}.`,
    `Ask exactly ${cap} short, specific questions whose answers ` +
      `would make the agent handle real calls better — policies, ` +
      `edge cases, exact wording to use, and when to escalate.`,
    known
      ? `The agent ALREADY knows these topics. Do NOT ask about ` +
        `them again:\n${known}`
      : `The agent currently knows nothing — start with the ` +
        `essentials a new hire would need.`,
    `Output ONLY the questions, one per line. No numbering, no ` +
      `preamble, no commentary.`,
  ].join('\n\n');
}

/** Defensive parse of the LLM's question list. Strips numbering
 * / bullets / "Q:" prefixes, drops blanks + near-empties,
 * de-dupes, caps. NEVER throws. */
export function parseInterviewQuestions(
  text: string,
  max: number = INTERVIEW_MAX_Q,
): string[] {
  if (typeof text !== 'string') return [];
  const cap = Number.isInteger(max) && max > 0 ? max : INTERVIEW_MAX_Q;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let q = raw.trim();
    if (!q) continue;
    q = q.replace(/^\s*(?:\d+[.)]|[-*•]|Q\s*[:.)-]?)\s*/i, '').trim();
    if (q.length < 5) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q.slice(0, 300));
    if (out.length >= cap) break;
  }
  return out;
}

/** Turn one answered interview question into an embeddable
 * training doc. '' when the answer is blank (skip — an
 * unanswered question teaches nothing). */
export function buildQaTrainingDoc(
  question: string,
  answer: string,
): string {
  const q = typeof question === 'string' ? question.trim() : '';
  const a = typeof answer === 'string' ? answer.trim() : '';
  if (!a) return '';
  return q ? `Q: ${q}\nA: ${a}` : a;
}
