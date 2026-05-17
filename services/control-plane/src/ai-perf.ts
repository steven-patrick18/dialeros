// Iter 207 — local optimization. Pure helpers that turn an
// operator perf config into Ollama generation options + a
// prompt-budget trim. The dominant cost in the Worker loop on
// this CPU box is the LLM round-trip; capping reply tokens +
// keeping the model resident + trimming an over-long prompt are
// the real, safe levers. EVERYTHING here is inert by default:
// an empty config reproduces the exact pre-207 request body
// ({ temperature: 0.6 }, no keep_alive, no trim), so the live
// loop is byte-identical until an operator tunes it.
//
// Pure only (no I/O) — exhaustively tested. The storage getter/
// setter live in app-settings.ts; the wiring in the route.

export interface PerfConfig {
  reply_length?: 'short' | 'medium' | 'long' | 'uncapped';
  temperature?: number;
  keep_warm?: boolean;
  num_ctx?: number;
  prompt_budget_chars?: number;
  tts_speed?: number;
}

export type OllamaOptions = Record<string, number>;

export const REPLY_LEN_TOKENS = {
  short: 96,
  medium: 192,
  long: 384,
} as const;
// == the value hardcoded in the pre-207 route, so the default
// path is unchanged.
export const DEFAULT_TEMPERATURE = 0.6;
export const KEEP_WARM_TTL = '30m';
export const TTS_SPEED_MIN = 0.7;
export const TTS_SPEED_MAX = 1.4;

/** Defensive parse of the stored JSON blob. NEVER throws;
 * missing / malformed => {} (=> all defaults => inert). */
export function parsePerfConfig(raw: string | null): PerfConfig {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    return o as PerfConfig;
  } catch {
    return {};
  }
}

/** Resolve Ollama /api/chat `options` + `keep_alive` from the
 * config. Empty config => { temperature: 0.6 } + undefined
 * keepAlive => the pre-207 body exactly. All numeric inputs are
 * clamped to sane ranges (a bad stored value can't wedge the
 * loop). */
export function resolveOllamaOptions(cfg: PerfConfig | null): {
  options: OllamaOptions;
  keepAlive: string | undefined;
} {
  const c = cfg ?? {};
  let temperature = DEFAULT_TEMPERATURE;
  if (
    typeof c.temperature === 'number' &&
    Number.isFinite(c.temperature)
  ) {
    temperature = Math.max(0, Math.min(1.5, c.temperature));
  }
  const options: OllamaOptions = { temperature };
  const len = c.reply_length;
  if (len === 'short' || len === 'medium' || len === 'long') {
    options.num_predict = REPLY_LEN_TOKENS[len];
  }
  if (
    typeof c.num_ctx === 'number' &&
    Number.isInteger(c.num_ctx) &&
    c.num_ctx >= 256 &&
    c.num_ctx <= 32768
  ) {
    options.num_ctx = c.num_ctx;
  }
  const keepAlive = c.keep_warm === true ? KEEP_WARM_TTL : undefined;
  return { options, keepAlive };
}

/** TTS playback-speed multiplier. Clamped; default 1.0 (inert
 * — the synth daemon plays at native speed unless tuned). */
export function resolveTtsSpeed(cfg: PerfConfig | null): number {
  const s = cfg?.tts_speed;
  if (typeof s === 'number' && Number.isFinite(s)) {
    return Math.max(TTS_SPEED_MIN, Math.min(TTS_SPEED_MAX, s));
  }
  return 1.0;
}

/** Trim an Ollama message array to a total-content char budget
 * by dropping the OLDEST history turns. Always kept: every
 * system message (identity/behaviour/RAG knowledge), the FIRST
 * assistant message (the greeting), and the LAST message (the
 * caller's current turn). maxChars <= 0 / non-int / already
 * within budget => returned unchanged (inert by default). Pure
 * + deterministic; order preserved. A smaller prompt = faster
 * CPU prefill with zero quality loss on the pinned content. */
export function budgetMessages<
  T extends { role: string; content: string },
>(messages: T[], maxChars: number): T[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }
  if (!Number.isInteger(maxChars) || maxChars <= 0) return messages;
  const total = (arr: T[]): number =>
    arr.reduce((n, mm) => n + (mm?.content?.length ?? 0), 0);
  if (total(messages) <= maxChars) return messages;
  const lastIdx = messages.length - 1;
  let firstAssistant = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'assistant') {
      firstAssistant = i;
      break;
    }
  }
  const pinned = (i: number): boolean =>
    messages[i]?.role === 'system' ||
    i === lastIdx ||
    i === firstAssistant;
  const dropped = new Set<number>();
  for (let i = 0; i < messages.length; i++) {
    const kept = messages.filter((_, idx) => !dropped.has(idx));
    if (total(kept) <= maxChars) break;
    if (pinned(i) || dropped.has(i)) continue;
    dropped.add(i);
  }
  return messages.filter((_, idx) => !dropped.has(idx));
}
