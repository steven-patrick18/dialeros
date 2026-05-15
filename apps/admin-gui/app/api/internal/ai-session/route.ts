import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  appendAiCallTurn,
  endAiCallSession,
  getAiPersona,
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

  return NextResponse.json({ error: 'unknown op' }, { status: 400 });
}
