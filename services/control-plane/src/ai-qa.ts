// Iter 197 — Post-call QA scoring for AI-handled calls.
//
// When an ai_call_session ends, a sweeper feeds the transcript
// + the persona's own instructions back to the local LLM and
// asks it to grade the AI agent's performance against that
// persona's intent. Score 0-100 + a one-line summary + a short
// flag list (compliance / quality markers).
//
// buildQaPrompt + parseQaResponse are pure (the grading prompt
// shape and the defensive JSON extraction are exactly the
// fragile parts worth unit-testing). gradeTranscript wires them
// to Ollama.

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';

export interface QaTurn {
  role: string; // 'caller' | 'ai'
  text: string;
}

export interface QaResult {
  score: number; // 0-100
  summary: string;
  flags: string[];
}

export interface OllamaMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Fixed flag vocabulary the grader is steered toward. Free-form
// flags from the model are still accepted (lowercased, hyphen-
// normalized) so a new failure mode isn't silently dropped, but
// the prompt anchors it on these.
export const QA_FLAG_VOCAB = [
  'goal-met',
  'goal-missed',
  'off-script',
  'rude-or-pushy',
  'compliance-risk',
  'caller-frustrated',
  'dead-air',
  'hallucinated',
  'good-handoff',
] as const;

export function buildQaPrompt(
  persona: { name: string; system_prompt: string },
  turns: QaTurn[],
): OllamaMsg[] {
  const transcript = turns
    .filter((t) => typeof t.text === 'string' && t.text.trim() !== '')
    .map(
      (t) =>
        `${t.role === 'ai' ? 'AGENT' : 'CALLER'}: ${t.text.trim()}`,
    )
    .join('\n');

  const system =
    'You are a strict call-center QA reviewer. You grade an AI ' +
    'voice agent against the instructions it was given. Be ' +
    'objective and terse. Respond with ONE JSON object and ' +
    'nothing else: ' +
    '{"score": <integer 0-100>, "summary": "<one sentence>", ' +
    '"flags": ["<short-kebab-tag>", ...]}. ' +
    'score 0-100 = how well the agent followed its instructions ' +
    'and served the caller. Prefer flags from this set when they ' +
    'apply: ' +
    QA_FLAG_VOCAB.join(', ') +
    '. No prose outside the JSON.';

  const user =
    `AGENT PERSONA "${persona.name}". ITS INSTRUCTIONS:\n` +
    persona.system_prompt +
    '\n\nCALL TRANSCRIPT:\n' +
    (transcript || '(no turns recorded)') +
    '\n\nGrade it now. JSON only.';

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Defensive parse: models wrap JSON in prose / fences despite
 * instructions. Extract the first balanced {...}, coerce + clamp
 * every field, never throw. A score we can't read becomes 0 with
 * a 'parse-failed' flag so the row is visibly bad rather than
 * silently absent. */
export function parseQaResponse(raw: string): QaResult {
  const fail: QaResult = {
    score: 0,
    summary: 'QA parse failed — model returned unparseable output.',
    flags: ['parse-failed'],
  };
  if (!raw || typeof raw !== 'string') return fail;

  // Strip ``` fences, then grab the first {...} block by brace
  // balance (handles trailing prose).
  const cleaned = raw.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  if (start < 0) return fail;
  let depth = 0;
  let end = -1;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return fail;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
  } catch {
    return fail;
  }

  let score = Number(obj.score);
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const summary =
    typeof obj.summary === 'string' && obj.summary.trim()
      ? obj.summary.trim().slice(0, 500)
      : '(no summary)';

  let flags: string[] = [];
  if (Array.isArray(obj.flags)) {
    flags = obj.flags
      .filter((f): f is string => typeof f === 'string')
      .map((f) =>
        f
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, ''),
      )
      .filter((f) => f.length > 0 && f.length <= 40)
      .slice(0, 12);
  }

  return { score, summary, flags };
}

export async function gradeTranscript(
  model: string,
  persona: { name: string; system_prompt: string },
  turns: QaTurn[],
): Promise<
  | { ok: true; result: QaResult; ms: number }
  | { ok: false; detail: string }
> {
  const messages = buildQaPrompt(persona, turns);
  const t0 = Date.now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        // Low temp — grading should be stable, not creative.
        options: { temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { ok: false, detail: `ollama HTTP ${res.status}` };
    }
    const j = (await res.json()) as { message?: { content?: string } };
    return {
      ok: true,
      result: parseQaResponse(j.message?.content ?? ''),
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'ollama unreachable',
    };
  }
}
