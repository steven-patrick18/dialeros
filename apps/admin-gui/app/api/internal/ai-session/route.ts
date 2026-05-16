import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  aiMemoryCandidates,
  appendAiCallTurn,
  buildOllamaMessages,
  buildRetrievalBlock,
  scrubIdentityLeak,
  callerTurnCount,
  embed,
  endAiCallSession,
  evaluateSessionGuard,
  getAiCallSession,
  getAiPersona,
  getDialIntentById,
  listAiCallTurns,
  parseEscalationKeywords,
  rankBySimilarity,
  resolveTransfer,
  startAiCallSession,
} from '@dialeros/control-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 190 — Token-gated AI session sink for the media-bridge
// daemon. Same trust model as the iter-137 ai-worker: the
// X-Inbound-Token header must match KAMAILIO_INBOUND_TOKEN. One
// route, dispatched on ?op=start|turn|end so the daemon only
// needs a single base URL.

function tokenOk(req: NextRequest): boolean {
  const expected = process.env.KAMAILIO_INBOUND_TOKEN;
  if (!expected) return false;
  return req.headers.get('x-inbound-token') === expected;
}


const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';

// Iter 194 — one LLM round-trip for the live call loop. Mirrors
// ai-persona.ts personaTextTurn but operates on the persisted
// session (not a sandbox). 25s timeout: a CPU 3B model on the
// 5-core box answers a short turn in ~2-6s; 25s is a generous
// ceiling before we bail + let the daemon play a filler / retry.
async function ollamaReply(
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<
  | { ok: true; reply: string; ms: number }
  | { ok: false; detail: string }
> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: { temperature: 0.6 },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      return { ok: false, detail: `ollama HTTP ${res.status}` };
    }
    const j = (await res.json()) as { message?: { content?: string } };
    return {
      ok: true,
      reply: (j.message?.content ?? '').trim(),
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'ollama unreachable',
    };
  }
}

export async function POST(req: NextRequest) {
  if (!tokenOk(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const op = req.nextUrl.searchParams.get('op');
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  if (op === 'start') {
    const personaId = String(body.persona_id ?? '');
    // Defensive: a session for an unknown / deleted persona is
    // still tracked (so the transcript isn't lost) but flagged.
    const persona = personaId ? getAiPersona(personaId) : undefined;
    const id = randomUUID();
    const row = startAiCallSession({
      id,
      dialIntentId:
        body.dial_intent_id != null
          ? Number(body.dial_intent_id)
          : null,
      personaId: personaId || 'unknown',
      callUuid: body.call_uuid ? String(body.call_uuid) : null,
      fromPhone: body.from_phone ? String(body.from_phone) : null,
    });
    return NextResponse.json({
      session_id: row.id,
      persona_found: Boolean(persona),
    });
  }

  if (op === 'turn') {
    const sessionId = String(body.session_id ?? '');
    if (!sessionId) {
      return NextResponse.json({ error: 'session_id required' }, { status: 400 });
    }
    appendAiCallTurn({
      sessionId,
      turnIndex: Number(body.turn_index ?? 0),
      role: String(body.role ?? 'caller'),
      text: String(body.text ?? ''),
      audioMs: body.audio_ms != null ? Number(body.audio_ms) : null,
      sttMs: body.stt_ms != null ? Number(body.stt_ms) : null,
      llmMs: body.llm_ms != null ? Number(body.llm_ms) : null,
      ttsMs: body.tts_ms != null ? Number(body.tts_ms) : null,
    });
    return NextResponse.json({ ok: true });
  }

  if (op === 'end') {
    const sessionId = String(body.session_id ?? '');
    if (!sessionId) {
      return NextResponse.json({ error: 'session_id required' }, { status: 400 });
    }
    endAiCallSession(
      sessionId,
      String(body.end_reason ?? 'unknown'),
      String(body.status ?? 'completed'),
    );
    return NextResponse.json({ ok: true });
  }

  if (op === 'respond') {
    const sessionId = String(body.session_id ?? '');
    const callerText = String(body.caller_text ?? '').trim();
    if (!sessionId || !callerText) {
      return NextResponse.json(
        { error: 'session_id + caller_text required' },
        { status: 400 },
      );
    }
    const session = getAiCallSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'session not found' }, { status: 404 });
    }
    const persona = getAiPersona(session.persona_id);
    if (!persona) {
      // Persona deleted mid-call — end gracefully rather than
      // looping a dead session.
      endAiCallSession(sessionId, 'persona_missing', 'aborted');
      return NextResponse.json({ action: 'end', reason: 'persona_missing' });
    }

    const turns = listAiCallTurns(sessionId).map((t) => ({
      role: t.role,
      text: t.text,
    }));
    const elapsedSeconds = Math.max(
      0,
      Math.floor(
        (Date.now() - Date.parse(session.started_at)) / 1000,
      ),
    );

    // iter-190 pure guard: escalation keyword > max_call_seconds
    // > max_turns. callerTurnCount includes this turn (it was
    // already persisted by op=turn before respond is called).
    const guard = evaluateSessionGuard(
      {
        caller_turns: callerTurnCount(turns, false),
        elapsed_seconds: elapsedSeconds,
        last_caller_text: callerText,
      },
      {
        max_turns: persona.max_turns,
        max_call_seconds: persona.max_call_seconds,
        escalation_keywords: parseEscalationKeywords(persona),
      },
    );
    if (guard.action === 'escalate') {
      endAiCallSession(sessionId, `escalate:${guard.matched}`, 'escalated');
      return NextResponse.json({
        action: 'escalate',
        reason: 'keyword',
        matched: guard.matched,
      });
    }
    if (guard.action === 'end') {
      endAiCallSession(sessionId, guard.reason, 'completed');
      return NextResponse.json({ action: 'end', reason: guard.reason });
    }

    // Iter 204 — RAG retrieval. When the Master memory store
    // has anything in scope (the call's campaign for outbound;
    // global always applies), embed the caller's line, rank the
    // candidates, and inject the top matches as authoritative
    // context. Best-effort: ANY failure (embed model down, a
    // bad stored vector) degrades to no knowledge — a live call
    // must NEVER break because retrieval hiccuped. Inert by
    // default: no scoped memory -> no embed call -> the prompt
    // is byte-identical to pre-204.
    // Iter 205 — one embedding, TWO consumers. The static
    // keyword guard already ran above; now (when the Master
    // store has anything in scope) embed the caller line ONCE
    // and use it for BOTH (a) learned transfer rules and (b)
    // iter-204 knowledge retrieval. Best-effort: ANY failure
    // degrades to no-transfer + no-knowledge — a live call must
    // NEVER break on a retrieval hiccup. Inert by default: no
    // scoped memory -> no embed -> loop byte-identical to
    // pre-204.
    let knowledge: string | null = null;
    let learnedTransfer: { reason: string; score: number } | null =
      null;
    try {
      let scopeType = 'global';
      let scopeId = '';
      if (session.dial_intent_id != null) {
        const di = getDialIntentById(session.dial_intent_id);
        if (di?.campaign_id) {
          scopeType = 'campaign';
          scopeId = di.campaign_id;
        }
      }
      const cands = aiMemoryCandidates(scopeType, scopeId);
      if (cands.length > 0) {
        const q = await embed(callerText);
        if (q.ok) {
          const scored = cands
            .map((mem) => {
              let vec: number[] = [];
              try {
                vec = JSON.parse(mem.embedding ?? '[]');
              } catch {
                vec = [];
              }
              return { item: mem, vector: vec };
            })
            .filter((cv) => cv.vector.length > 0);
          // (a) Learned transfer (iter 205) — rank ONLY the
          // transfer_rule rows; a close paraphrase of a prior
          // real escalation hands off now.
          const tRules = scored.filter(
            (cv) => cv.item.kind === 'transfer_rule',
          );
          if (tRules.length > 0) {
            const tRanked = rankBySimilarity(q.vector, tRules, 1);
            const dec = resolveTransfer(
              tRanked.map((h) => ({
                reason: h.item.title,
                score: h.score,
              })),
            );
            if (dec.transfer) {
              learnedTransfer = {
                reason: dec.reason,
                score: dec.score,
              };
            }
          }
          // (b) Knowledge retrieval (iter 204) — skip the
          // transfer_rule rows (triggers, not facts). Skipped
          // entirely when we are about to transfer.
          if (!learnedTransfer) {
            const ranked = rankBySimilarity(
              q.vector,
              scored.filter(
                (cv) => cv.item.kind !== 'transfer_rule',
              ),
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
      }
    } catch (e) {
      console.warn('[ai-session] retrieval/transfer skipped:', e);
      knowledge = null;
      learnedTransfer = null;
    }

    // Iter 205 — a LEARNED transfer fires the SAME escalate seam
    // the keyword guard uses: media-bridge closes the WS, FS
    // bridges a human via the bound campaign fallback (iter
    // 190/192). The matched rule's scope was recorded when it
    // was mined; routing to a SPECIFIC in-group via new dialplan
    // is deliberately deferred — this iter ships the learned
    // DECISION, not new FreeSWITCH plumbing.
    if (learnedTransfer) {
      endAiCallSession(
        sessionId,
        `escalate:learned:${learnedTransfer.reason}`,
        'escalated',
      );
      return NextResponse.json({
        action: 'escalate',
        reason: 'learned_transfer',
        matched: learnedTransfer.reason,
        score: learnedTransfer.score,
        learned: true,
      });
    }

    const messages = buildOllamaMessages(
      {
        system_prompt: persona.system_prompt,
        greeting: persona.greeting,
        agent_name: persona.agent_name,
        agent_title: persona.agent_title,
      },
      turns,
      callerText,
      undefined,
      knowledge,
    );
    const out = await ollamaReply(persona.llm_model, messages);
    if (!out.ok) {
      // LLM glitch — don't kill the call; tell the daemon to
      // hold (it can replay a filler + the caller can repeat).
      return NextResponse.json({
        action: 'hold',
        detail: out.detail,
      });
    }
    const scrubbed = scrubIdentityLeak(
      out.reply,
      persona.agent_name ?? '',
      persona.agent_title,
    ).text;
    const nextIndex = turns.length + 1;
    appendAiCallTurn({
      sessionId,
      turnIndex: nextIndex,
      role: 'ai',
      text: scrubbed,
      llmMs: out.ms,
    });
    return NextResponse.json({
      action: 'speak',
      reply: scrubbed,
      tts_engine: persona.tts_engine,
      tts_voice: persona.tts_voice,
      llm_ms: out.ms,
    });
  }

  return NextResponse.json({ error: 'unknown op' }, { status: 400 });
}
