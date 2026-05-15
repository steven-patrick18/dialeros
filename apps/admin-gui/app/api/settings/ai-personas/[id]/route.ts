import { NextRequest, NextResponse } from 'next/server';
import {
  AiPersonaInputSchema,
  appendAudit,
  deleteAiPersona,
  getAiPersona,
  updateAiPersona,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 189 — Single AI persona: PATCH (partial) + DELETE. Admin
// only. Cross-org access blocked.

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const existing = getAiPersona(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (existing.org_id !== me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = AiPersonaInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }
  updateAiPersona(id, parsed.data);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'ai_persona.updated',
    targetType: 'ai_persona',
    targetId: id,
    payload: { keys: Object.keys(parsed.data) },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const existing = getAiPersona(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (existing.org_id !== me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  deleteAiPersona(id);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'ai_persona.deleted',
    targetType: 'ai_persona',
    targetId: id,
    payload: { name: existing.name },
  });
  return NextResponse.json({ ok: true });
}
