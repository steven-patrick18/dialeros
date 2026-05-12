import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { appendAudit, applyAiResult } from '@dialeros/control-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 135 — AI worker callback. The operator's STT+LLM worker
// POSTs here once it has a transcript and/or summary for a
// previously-pending dial_intent.id. Stamping ai_processed_at
// (always, even when both columns are NULL) is what removes the
// row from the pending list — operator's worker must POST back
// even on failure to avoid the same row being re-processed
// forever. Suggested convention: pass null for whichever field
// the worker couldn't produce.
//
// Token gate is the same as ai-pending.

const INTERNAL_TOKEN = process.env.KAMAILIO_INBOUND_TOKEN ?? '';

const BodySchema = z.object({
  intent_id: z.number().int().positive(),
  // Transcript can be megabyte-scale on long calls; cap at 200kB
  // (≈30k words / ≈3hr at 10 wpm) to keep db row sizes sensible.
  transcript_text: z.string().max(200_000).nullable(),
  // Summary is a paragraph or two — cap at 8kB.
  ai_summary: z.string().max(8_000).nullable(),
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
      transcript_chars: parsed.data.transcript_text?.length ?? 0,
      summary_chars: parsed.data.ai_summary?.length ?? 0,
    },
  });
  return NextResponse.json({ ok: true });
}
