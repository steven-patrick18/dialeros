// Iter 212 — Mock Call. A text "call" the operator can drive as
// the customer to test an agent BEFORE (or without) a real
// phone call. It runs the EXACT live-call building blocks —
// scope retrieval of trained memory (iter 204) → identity +
// behaviour-guarded prompt (iter 199/200) → the configured
// LOCAL provider (iter 209) → identity scrub (iter 199) — so
// what you see here is what a real caller would get.
//
// Deliberately EPHEMERAL: no ai_call_session / turns are
// written, so a test never pollutes reports, QA scoring, or the
// auto-curated exemplar / transfer-rule learning. It is a
// faithful predictor, not a real call.
//
// This is pure I/O orchestration over already-unit-tested
// primitives (buildRetrievalBlock, buildOllamaMessages,
// scrubIdentityLeak, the ai-llm layer) — no new pure logic.

import type { AiPersonaRow } from './ai-persona';
import { aiMemoryCandidates } from './db';
import { embed, rankBySimilarity } from './ai-memory';
import { buildRetrievalBlock } from './ai-rag';
import { buildOllamaMessages } from './ai-conversation';
import { scrubIdentityLeak } from './ai-identity';
import { getLlmProvider, getAiPerfConfig } from './app-settings';
import { resolveOllamaOptions, budgetMessages } from './ai-perf';
import {
  buildChatRequest,
  parseChatReply,
  resolveLlmModel,
} from './ai-llm';

export interface MockTurnInput {
  persona: AiPersonaRow;
  history: Array<{ role: string; text: string }>; // 'caller' | 'ai'
  callerText: string;
  scopeType?: string; // global | campaign | in_group
  scopeId?: string;
}

export interface MockTurnResult {
  ok: boolean;
  reply: string;
  used_knowledge: boolean;
  ms: number;
  detail?: string;
}

export async function runMockTurn(
  inp: MockTurnInput,
): Promise<MockTurnResult> {
  const t0 = Date.now();
  const scopeType =
    inp.scopeType === 'campaign' || inp.scopeType === 'in_group'
      ? inp.scopeType
      : 'global';
  const scopeId = scopeType === 'global' ? '' : inp.scopeId || '';

  // Retrieval — identical to the live respond path. Best-effort:
  // any failure degrades to no knowledge (never breaks the test).
  let knowledge: string | null = null;
  try {
    const cands = aiMemoryCandidates(scopeType, scopeId);
    if (cands.length > 0) {
      const q = await embed(inp.callerText);
      if (q.ok) {
        const ranked = rankBySimilarity(
          q.vector,
          cands
            .map((mem) => {
              let vec: number[] = [];
              try {
                vec = JSON.parse(mem.embedding ?? '[]');
              } catch {
                vec = [];
              }
              return { item: mem, vector: vec };
            })
            .filter((cv) => cv.vector.length > 0),
          3,
          0.5,
        );
        knowledge = buildRetrievalBlock(
          ranked.map((h) => ({
            title: h.item.title,
            content: h.item.content,
            score: h.score,
          })),
        );
      }
    }
  } catch {
    knowledge = null;
  }

  const messages = buildOllamaMessages(
    {
      system_prompt: inp.persona.system_prompt,
      greeting: inp.persona.greeting,
      agent_name: inp.persona.agent_name,
      agent_title: inp.persona.agent_title,
    },
    inp.history,
    inp.callerText,
    undefined,
    knowledge,
  );

  const prov = getLlmProvider();
  // Apply the SAME operator perf knobs the live respond path
  // uses (iter 207): short-reply num_predict cap + prompt budget
  // + keep-warm. This makes the mock both fast on a CPU box AND
  // a faithful mirror of a real call. Generous 90s timeout (the
  // live path keeps the strict 25s ceiling — a real caller can't
  // wait; a tester must actually return); always keep the model
  // resident during a test session.
  const perf = getAiPerfConfig();
  const { options, keepAlive } = resolveOllamaOptions(perf);
  const budgeted = budgetMessages(
    messages,
    perf.prompt_budget_chars ?? 0,
  );
  const reqd = buildChatRequest(
    prov,
    resolveLlmModel(prov, inp.persona.llm_model),
    budgeted,
    options,
    keepAlive ?? '30m',
  );
  try {
    const res = await fetch(reqd.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...reqd.headers },
      body: JSON.stringify(reqd.body),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        reply: '',
        used_knowledge: !!knowledge,
        ms: Date.now() - t0,
        detail: `LLM HTTP ${res.status}`,
      };
    }
    const raw = parseChatReply(prov, await res.json());
    const reply = scrubIdentityLeak(
      raw,
      inp.persona.agent_name ?? '',
      inp.persona.agent_title,
    ).text;
    return {
      ok: true,
      reply,
      used_knowledge: !!knowledge,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      ok: false,
      reply: '',
      used_knowledge: !!knowledge,
      ms: Date.now() - t0,
      detail: e instanceof Error ? e.message : 'LLM unreachable',
    };
  }
}
