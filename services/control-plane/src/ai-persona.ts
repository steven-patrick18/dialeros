// Iter 189 — Phase K: AI Agent persona domain module.
//
// iter 189 = config + CRUD + a text-mode round-trip sandbox so an
// operator can iterate on the system prompt against the real LLM
// before any call is wired. The real-time STT→LLM→TTS loop +
// FreeSWITCH media bridge land in iter 190+.
//
// LLM transport: Ollama's /api/chat over 127.0.0.1:11434 (same
// endpoint the iter-137 post-call worker uses). When Ollama is
// not installed/running, callers get a structured 'llm_offline'
// result rather than an exception — the UI renders an
// actionable "install via scripts/install-ai-stack.sh" message.

import { randomUUID } from 'crypto';
import { applyIdentity, scrubIdentityLeak } from './ai-identity';
import { getDb } from './db';
import { z } from 'zod';

export interface AiPersonaRow {
  id: string;
  org_id: string;
  name: string;
  enabled: number;
  system_prompt: string;
  greeting: string;
  agent_name: string | null;
  agent_title: string | null;
  llm_model: string;
  stt_model: string;
  tts_engine: string;
  tts_voice: string | null;
  max_turns: number;
  max_call_seconds: number;
  escalation_keywords_json: string;
  created_at: string;
  updated_at: string;
}

export const TtsEngineSchema = z.enum(['piper', 'coqui']);

export const AiPersonaInputSchema = z.object({
  name: z.string().min(1).max(80),
  enabled: z.boolean().optional(),
  system_prompt: z.string().min(1).max(8000),
  greeting: z.string().min(1).max(1000),
  agent_name: z.string().max(80).nullable().optional(),
  agent_title: z.string().max(80).nullable().optional(),
  llm_model: z.string().min(1).max(80).optional(),
  stt_model: z.string().min(1).max(40).optional(),
  tts_engine: TtsEngineSchema.optional(),
  tts_voice: z.string().max(200).nullable().optional(),
  max_turns: z.number().int().min(1).max(200).optional(),
  max_call_seconds: z.number().int().min(15).max(3600).optional(),
  escalation_keywords: z.array(z.string().min(1).max(80)).max(50).optional(),
});
export type AiPersonaInput = z.infer<typeof AiPersonaInputSchema>;

export function listAiPersonas(orgId = 'default'): AiPersonaRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM ai_personas WHERE org_id = ? ORDER BY name ASC`,
    )
    .all(orgId) as unknown as AiPersonaRow[];
}

export function getAiPersona(id: string): AiPersonaRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM ai_personas WHERE id = ?`)
    .get(id) as unknown as AiPersonaRow | undefined;
}

export function insertAiPersona(
  input: AiPersonaInput,
  orgId = 'default',
): AiPersonaRow {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO ai_personas
         (id, org_id, name, enabled, system_prompt, greeting,
          agent_name, agent_title,
          llm_model, stt_model, tts_engine, tts_voice,
          max_turns, max_call_seconds, escalation_keywords_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      orgId,
      input.name,
      input.enabled ? 1 : 0,
      input.system_prompt,
      input.greeting,
      input.agent_name ?? null,
      input.agent_title ?? null,
      input.llm_model ?? 'qwen2.5:3b',
      input.stt_model ?? 'base.en',
      input.tts_engine ?? 'piper',
      input.tts_voice ?? null,
      input.max_turns ?? 20,
      input.max_call_seconds ?? 300,
      JSON.stringify(input.escalation_keywords ?? []),
    );
  return getAiPersona(id) as AiPersonaRow;
}

export function updateAiPersona(
  id: string,
  input: Partial<AiPersonaInput>,
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  const set = (col: string, v: unknown) => {
    fields.push(`${col} = ?`);
    values.push(v);
  };
  if (input.name !== undefined) set('name', input.name);
  if (input.enabled !== undefined) set('enabled', input.enabled ? 1 : 0);
  if (input.system_prompt !== undefined)
    set('system_prompt', input.system_prompt);
  if (input.greeting !== undefined) set('greeting', input.greeting);
  if (input.agent_name !== undefined)
    set('agent_name', input.agent_name ?? null);
  if (input.agent_title !== undefined)
    set('agent_title', input.agent_title ?? null);
  if (input.llm_model !== undefined) set('llm_model', input.llm_model);
  if (input.stt_model !== undefined) set('stt_model', input.stt_model);
  if (input.tts_engine !== undefined) set('tts_engine', input.tts_engine);
  if (input.tts_voice !== undefined)
    set('tts_voice', input.tts_voice ?? null);
  if (input.max_turns !== undefined) set('max_turns', input.max_turns);
  if (input.max_call_seconds !== undefined)
    set('max_call_seconds', input.max_call_seconds);
  if (input.escalation_keywords !== undefined)
    set(
      'escalation_keywords_json',
      JSON.stringify(input.escalation_keywords),
    );
  if (fields.length === 0) return false;
  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  values.push(id);
  const result = getDb()
    .prepare(`UPDATE ai_personas SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]));
  return Number(result.changes) > 0;
}

export function deleteAiPersona(id: string): boolean {
  const result = getDb()
    .prepare(`DELETE FROM ai_personas WHERE id = ?`)
    .run(id);
  return Number(result.changes) > 0;
}

export function parseEscalationKeywords(row: AiPersonaRow): string[] {
  try {
    const arr = JSON.parse(row.escalation_keywords_json);
    return Array.isArray(arr)
      ? arr.filter((s): s is string => typeof s === 'string')
      : [];
  } catch {
    return [];
  }
}

/* =====================================================================
 * AI-stack health + text-mode sandbox
 * =====================================================================
 */

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const COQUI_URL = process.env.COQUI_TTS_URL ?? 'http://127.0.0.1:11123';

export interface AiStackHealth {
  ollama: { up: boolean; models: string[]; detail?: string };
  coqui: { up: boolean; detail?: string };
}

export async function probeAiStack(): Promise<AiStackHealth> {
  const out: AiStackHealth = {
    ollama: { up: false, models: [] },
    coqui: { up: false },
  };
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const j = (await res.json()) as {
        models?: Array<{ name: string }>;
      };
      out.ollama.up = true;
      out.ollama.models = (j.models ?? []).map((m) => m.name);
    } else {
      out.ollama.detail = `HTTP ${res.status}`;
    }
  } catch (e) {
    out.ollama.detail =
      e instanceof Error ? e.message : 'unreachable';
  }
  try {
    const res = await fetch(`${COQUI_URL}/health`, {
      signal: AbortSignal.timeout(2500),
    });
    out.coqui.up = res.ok;
    if (!res.ok) out.coqui.detail = `HTTP ${res.status}`;
  } catch (e) {
    out.coqui.detail = e instanceof Error ? e.message : 'unreachable';
  }
  return out;
}

export type PersonaTestResult =
  | { ok: true; reply: string; model: string; latency_ms: number }
  | {
      ok: false;
      reason: 'llm_offline' | 'llm_error' | 'timeout';
      detail: string;
    };

/** Single text round-trip: feed the persona's system prompt + a
 * synthetic conversation history + the operator's "customer
 * line", return the LLM's next reply. Lets the operator tune the
 * prompt against the real model before any call is wired. */
export async function personaTextTurn(args: {
  systemPrompt: string;
  greeting: string;
  model: string;
  history: Array<{ role: 'assistant' | 'user'; content: string }>;
  customerLine: string;
  agentName?: string | null;
  agentTitle?: string | null;
}): Promise<PersonaTestResult> {
  const messages = [
    {
      role: 'system' as const,
      content: applyIdentity(
        args.systemPrompt,
        args.agentName ?? '',
        args.agentTitle ?? null,
      ),
    },
    // Seed the convo with the greeting as the assistant's opener
    // so the model has the same context the call loop will give it.
    { role: 'assistant' as const, content: args.greeting },
    ...args.history,
    { role: 'user' as const, content: args.customerLine },
  ];
  const started = Date.now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: args.model,
        messages,
        stream: false,
        options: { temperature: 0.6 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      // 404 from Ollama = model not pulled; surface it precisely.
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        reason: 'llm_error',
        detail: `Ollama HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`,
      };
    }
    const j = (await res.json()) as {
      message?: { content?: string };
    };
    const reply = j.message?.content?.trim() ?? '';
    return {
      ok: true,
      reply,
      model: args.model,
      latency_ms: Date.now() - started,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort|timeout/i.test(msg)) {
      return { ok: false, reason: 'timeout', detail: msg };
    }
    // ECONNREFUSED / ENOTFOUND → Ollama isn't installed/running.
    return {
      ok: false,
      reason: 'llm_offline',
      detail:
        'Ollama unreachable at ' +
        OLLAMA_URL +
        ' — install the local LLM via scripts/install-ai-stack.sh, then `ollama pull ' +
        args.model +
        '`.',
    };
  }
}
