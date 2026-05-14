import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  clearDialIntentQaFlag,
  getDialIntentById,
  setDialIntentQaFlag,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 176 — Flag a dial_intent for QA review (live monitoring
// supervisors hit this mid-call) or clear an existing flag.
// admin + supervisor only.

const FlagSchema = z.object({
  intent_id: z.number().int().positive(),
  reason: z.string().max(500).optional(),
  clear: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return NextResponse.json(
      { error: 'Admin or supervisor role required' },
      { status: 403 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = FlagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const intent = getDialIntentById(parsed.data.intent_id);
  if (!intent) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (parsed.data.clear) {
    clearDialIntentQaFlag(parsed.data.intent_id);
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'qa_flag.cleared',
      targetType: 'dial_intent',
      targetId: String(parsed.data.intent_id),
      payload: {},
    });
    return NextResponse.json({ ok: true, flagged: false });
  }

  setDialIntentQaFlag(
    parsed.data.intent_id,
    me.id,
    parsed.data.reason ?? null,
  );
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'qa_flag.set',
    targetType: 'dial_intent',
    targetId: String(parsed.data.intent_id),
    payload: { reason: parsed.data.reason ?? null },
  });
  return NextResponse.json({ ok: true, flagged: true });
}
