import { NextRequest, NextResponse } from 'next/server';
import {
  getAiPersona,
  runMockTurn,
  userHasPermission,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 212 — Mock Call. Drive a persona as the customer, in
// text, through the REAL live pipeline (retrieval + guards +
// provider + scrub). Ephemeral — nothing is persisted. admin OR
// ai.manage.

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (me.role !== 'admin' && !userHasPermission(me, 'ai.manage')) {
    return NextResponse.json(
      { error: 'ai.manage required' },
      { status: 403 },
    );
  }
  const b = (await req.json().catch(() => ({}))) as {
    persona_id?: unknown;
    history?: unknown;
    customer_line?: unknown;
    scope_type?: unknown;
    scope_id?: unknown;
  };
  const personaId = String(b.persona_id ?? '').trim();
  const customerLine = String(b.customer_line ?? '').trim();
  if (!personaId || !customerLine) {
    return NextResponse.json(
      { error: 'persona_id + customer_line required' },
      { status: 400 },
    );
  }
  const persona = getAiPersona(personaId);
  if (!persona) {
    return NextResponse.json(
      { error: 'persona not found' },
      { status: 404 },
    );
  }
  const history = Array.isArray(b.history)
    ? b.history
        .map((t) => ({
          role: String((t as { role?: unknown })?.role ?? ''),
          text: String((t as { text?: unknown })?.text ?? ''),
        }))
        .filter(
          (t) =>
            (t.role === 'caller' || t.role === 'ai') &&
            t.text.trim() !== '',
        )
        .slice(-32)
    : [];

  const result = await runMockTurn({
    persona,
    history,
    callerText: customerLine,
    scopeType:
      b.scope_type === 'campaign' || b.scope_type === 'in_group'
        ? String(b.scope_type)
        : 'global',
    scopeId: String(b.scope_id ?? ''),
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.detail ?? 'mock turn failed', ms: result.ms },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    reply: result.reply,
    used_knowledge: result.used_knowledge,
    ms: result.ms,
  });
}
