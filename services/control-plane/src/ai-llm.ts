// Iter 209 — pluggable LOCAL LLM provider. Pure: request
// shaping + response parsing + a URL locality guard. The fetch
// + storage live in the callers / app-settings. Two transports:
// 'ollama' (/api/chat) and 'openai_compat' (/v1/chat/
// completions — llama.cpp-server, vLLM, both LOCAL). The
// default provider produces a request byte-identical to the
// pre-209 hardcoded Ollama call, so every wired site is inert
// by default.
//
// HARD RULE: DialerOS never speaks to an external service.
// isLocalLlmUrl() enforces that and the setter route rejects a
// non-local base_url, so pluggability can't smuggle in a cloud
// API.

export type LlmKind = 'ollama' | 'openai_compat';

export interface LlmProvider {
  kind: LlmKind;
  base_url: string;
  model_override?: string;
  // ONLY for a local server that wants a dummy bearer
  // (llama.cpp --api-key, vLLM). The locality guard forbids a
  // non-local host, so this can never be a cloud key.
  api_key?: string;
}

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

export function defaultLlmProvider(): LlmProvider {
  return { kind: 'ollama', base_url: DEFAULT_OLLAMA_URL };
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/** Defensive parse of the stored JSON. Never throws; anything
 * unusable => the default Ollama provider (=> inert). */
export function parseLlmProvider(raw: string | null): LlmProvider {
  if (!raw) return defaultLlmProvider();
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return defaultLlmProvider();
    const kind: LlmKind =
      o.kind === 'openai_compat' ? 'openai_compat' : 'ollama';
    const base_url =
      typeof o.base_url === 'string' && o.base_url.trim()
        ? stripTrailingSlash(o.base_url.trim())
        : DEFAULT_OLLAMA_URL;
    const provider: LlmProvider = { kind, base_url };
    if (
      typeof o.model_override === 'string' &&
      o.model_override.trim()
    ) {
      provider.model_override = o.model_override.trim();
    }
    if (typeof o.api_key === 'string' && o.api_key) {
      provider.api_key = o.api_key;
    }
    return provider;
  } catch {
    return defaultLlmProvider();
  }
}

/** A single capable local model can override every persona's
 * configured model once you upgrade hardware. */
export function resolveLlmModel(
  prov: LlmProvider,
  personaModel: string,
): string {
  const o = prov?.model_override;
  return typeof o === 'string' && o.trim() ? o.trim() : personaModel;
}

/** Locality guard. Allows loopback, RFC1918, link-local,
 * .local / .internal, and single-label hostnames (container /
 * compose service names). Anything publicly routable => false.
 * Pure; enforced by the setter route. */
export function isLocalLlmUrl(url: string): boolean {
  if (typeof url !== 'string' || !url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return false;
  }
  const raw = u.hostname.toLowerCase();
  // URL.hostname keeps IPv6 brackets ("[::1]") — strip them.
  const h =
    raw.startsWith('[') && raw.endsWith(']')
      ? raw.slice(1, -1)
      : raw;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') {
    return true;
  }
  // IPv6 loopback / link-local (fe80::/10) / ULA (fc00::/7).
  if (
    h.includes(':') &&
    (h === '::1' ||
      h.startsWith('fe80:') ||
      h.startsWith('fc') ||
      h.startsWith('fd'))
  ) {
    return true;
  }
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (!h.includes('.') && !h.includes(':')) return true; // single label
  const m = h.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export type ValidateResult =
  | { ok: true; provider: LlmProvider }
  | { ok: false; error: string };

export function validateLlmProvider(
  input: unknown,
): ValidateResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'provider must be an object' };
  }
  const o = input as Record<string, unknown>;
  const kind: LlmKind =
    o.kind === 'openai_compat' ? 'openai_compat' : 'ollama';
  const base_url =
    typeof o.base_url === 'string' ? o.base_url.trim() : '';
  if (!base_url) return { ok: false, error: 'base_url required' };
  if (!isLocalLlmUrl(base_url)) {
    return {
      ok: false,
      error:
        'base_url must be a LOCAL endpoint (loopback / private / ' +
        '.local / service name). DialerOS never calls an ' +
        'external service.',
    };
  }
  const provider: LlmProvider = {
    kind,
    base_url: stripTrailingSlash(base_url),
  };
  if (
    typeof o.model_override === 'string' &&
    o.model_override.trim()
  ) {
    provider.model_override = o.model_override.trim();
  }
  if (typeof o.api_key === 'string' && o.api_key) {
    provider.api_key = o.api_key;
  }
  return { ok: true, provider };
}

export interface ChatRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Provider-specific chat request. 'ollama' + default base ==
 * the exact pre-209 body. `options` is the caller's existing
 * Ollama options; for openai_compat it is mapped (temperature
 * passthrough, num_predict -> max_tokens). */
export function buildChatRequest(
  prov: LlmProvider,
  model: string,
  messages: Array<{ role: string; content: string }>,
  options: Record<string, unknown>,
  keepAlive?: string,
): ChatRequest {
  const base = stripTrailingSlash(
    prov?.base_url || DEFAULT_OLLAMA_URL,
  );
  if (prov?.kind === 'openai_compat') {
    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
    };
    const temp = options?.temperature;
    if (typeof temp === 'number') body.temperature = temp;
    const np = options?.num_predict;
    if (typeof np === 'number') body.max_tokens = np;
    const headers: Record<string, string> = {};
    if (prov.api_key) {
      headers.Authorization = `Bearer ${prov.api_key}`;
    }
    return { url: `${base}/v1/chat/completions`, headers, body };
  }
  return {
    url: `${base}/api/chat`,
    headers: {},
    body: {
      model,
      messages,
      stream: false,
      options,
      ...(keepAlive ? { keep_alive: keepAlive } : {}),
    },
  };
}

/** Assistant text from a provider response. Never throws;
 * '' when absent. Trims (matches the pre-209 behaviour). */
export function parseChatReply(
  prov: LlmProvider,
  json: unknown,
): string {
  if (!json || typeof json !== 'object') return '';
  if (prov?.kind === 'openai_compat') {
    const j = json as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = j.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content.trim() : '';
  }
  const j = json as { message?: { content?: unknown } };
  const content = j.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

export interface ModelsRequest {
  url: string;
  headers: Record<string, string>;
}
export function buildModelsRequest(
  prov: LlmProvider,
): ModelsRequest {
  const base = stripTrailingSlash(
    prov?.base_url || DEFAULT_OLLAMA_URL,
  );
  if (prov?.kind === 'openai_compat') {
    const headers: Record<string, string> = {};
    if (prov.api_key) {
      headers.Authorization = `Bearer ${prov.api_key}`;
    }
    return { url: `${base}/v1/models`, headers };
  }
  return { url: `${base}/api/tags`, headers: {} };
}
export function parseModelsResponse(
  prov: LlmProvider,
  json: unknown,
): string[] {
  if (!json || typeof json !== 'object') return [];
  if (prov?.kind === 'openai_compat') {
    const j = json as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(j.data)) return [];
    return j.data
      .map((x) => (typeof x?.id === 'string' ? x.id : ''))
      .filter((s) => s.length > 0);
  }
  const j = json as { models?: Array<{ name?: unknown }> };
  if (!Array.isArray(j.models)) return [];
  return j.models
    .map((x) => (typeof x?.name === 'string' ? x.name : ''))
    .filter((s) => s.length > 0);
}
