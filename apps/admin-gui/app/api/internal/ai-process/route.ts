import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { appendAudit, applyAiResult } from '@dialeros/control-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 135 / iter 138 — AI worker callback. Extended in iter 138
// to accept the structured-classification outputs (ai_sentiment +
// ai_flags) alongside the free-text transcript + summary from
// iter 135. All four fields independent; worker may produce some
// and not others. ai_processed_at is stamped on every POST so the
// row falls off the pending queue regardless.

const INTERNAL_TOKEN = process.env.KAMAILIO_INBOUND_TOKEN ?? '';

// Vocab pinned in both server-side validator AND in the worker
// (CLASSIFY_PROMPT lists the same set). Anything outside this
// list silently drops at write time so a hallucinating LLM
// can't poison the dataset.
const ALLOWED_SENTIMENT = [
  'positive',
  'neutral',
  'negative',
  'mixed',
] as const;
const ALLOWED_FLAGS = [
  'DNC_REQUESTED',
  'HOSTILE',
  'WRONG_NUMBER',
  'RECORDING_OBJECTION',
  'CALLBACK_PROMISED',
  'SALE_CONFIRMED',
  'VOICEMAIL_DROPPED',
] as const;

const BodySchema = z.object({
  intent_id: z.number().int().positive(),
  transcript_text: z.string().max(200_000).nullable(),
  ai_summary: z.string().max(8_000).nullable(),
  ai_sentiment: z
    .enum(ALLOWED_SENTIMENT)
    .nullable()
    .optional(),
  ai_flags: z
    .array(z.enum(ALLOWED_FLAGS))
    .max(10)
    .nullable()
    .optional(),
});

function checkToken(req: NextRequest): boolean {
  if (!INTERNAL_TOKEN) return true;
  const presented = req.headers.get('x-inbound-token') ?? '';
  if (presented && presented === INTERNAL_TOKEN) return true;
  const auth = req.headers.get('authorization') ?? '';
  const m = /^Basic\s+(.+)$/i.exec(auth);
  if (m) {
    try {
      const decoded = Buffer.from(m[1]!, 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      const candidate = idx >= 0 ? decoded.slice(idx + 1) : decoded;
      if (candidate === INTERNAL_TOKEN) return true;
    } catch {
      /* malformed */
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  if (!checkToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!INTERNAL_TOKEN) {
    // eslint-disable-next-line no-console
    console.warn(
      '[ai-process] KAMAILIO_INBOUND_TOKEN not set — accepting unauthenticated requests',
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }
  const ok = applyAiResult({
    id: parsed.data.intent_id,
    transcript_text: parsed.data.transcript_text,
    ai_summary: parsed.data.ai_summary,
    ai_sentiment: parsed.data.ai_sentiment,
    ai_flags: parsed.data.ai_flags,
  });
  if (!ok) {
    return NextResponse.json(
      { error: 'dial_intent not found' },
      { status: 404 },
    );
  }
  appendAudit({
    actorUserId: null,
    actorIp: null,
    action: 'ai.processed',
    targetType: 'dial_intent',
    targetId: String(parsed.data.intent_id),
    payload: {
      has_transcript: parsed.data.transcript_text !== null,
      has_summary: parsed.data.ai_summary !== null,
      sentiment: parsed.data.ai_sentiment ?? null,
      flags: parsed.data.ai_flags ?? null,
      transcript_chars: parsed.data.transcript_text?.length ?? 0,
      summary_chars: parsed.data.ai_summary?.length ?? 0,
    },
  });
  return NextResponse.json({ ok: true });
}
