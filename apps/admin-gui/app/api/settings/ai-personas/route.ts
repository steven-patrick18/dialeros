import { NextRequest, NextResponse } from 'next/server';
import {
  AiPersonaInputSchema,
  appendAudit,
  insertAiPersona,
  listAiPersonas,
  userHasPermission,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 189 — AI personas list + create. Admin only.

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (me.role !== 'admin' && !userHasPermission(me, 'ai.manage')) {
    return NextResponse.json({ error: 'ai.manage permission required' }, { status: 403 });
  }
  const rows = JSON.parse(
    JSON.stringify(listAiPersonas(me.org_id)),
  ) as ReturnType<typeof listAiPersonas>;
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (me.role !== 'admin' && !userHasPermission(me, 'ai.manage')) {
    return NextResponse.json({ error: 'ai.manage permission required' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = AiPersonaInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid persona' },
      { status: 400 },
    );
  }
  const row = insertAiPersona(parsed.data, me.org_id);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'ai_persona.created',
    targetType: 'ai_persona',
    targetId: row.id,
    payload: { name: row.name, llm_model: row.llm_model },
  });
  return NextResponse.json({ row: JSON.parse(JSON.stringify(row)) });
}
