import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  appendAiCallTurn,
  buildOllamaMessages,
  callerTurnCount,
  endAiCallSession,
  evaluateSessionGuard,
  getAiCallSession,
  getAiPersona,
  listAiCallTurns,
  parseEscalationKeywords,
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

    const messages = buildOllamaMessages(
      { system_prompt: persona.system_prompt, greeting: persona.greeting },
      turns,
      callerText,
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
    const nextIndex = turns.length + 1;
    appendAiCallTurn({
      sessionId,
      turnIndex: nextIndex,
      role: 'ai',
      text: out.reply,
      llmMs: out.ms,
    });
    return NextResponse.json({
      action: 'speak',
      reply: out.reply,
      tts_engine: persona.tts_engine,
      tts_voice: persona.tts_voice,
      llm_ms: out.ms,
    });
  }

  return NextResponse.json({ error: 'unknown op' }, { status: 400 });
}
