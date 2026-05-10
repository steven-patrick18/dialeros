import { NextRequest, NextResponse } from 'next/server';
import {
  RemoteAgentUpdateInputSchema,
  appendAudit,
  deleteRemoteAgent,
  getRemoteAgent,
  updateRemoteAgent,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const r = getRemoteAgent(id);
  if (!r) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(r);
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const existing = getRemoteAgent(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = RemoteAgentUpdateInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
          .join('; '),
      },
      { status: 400 },
    );
  }
  const result = updateRemoteAgent(id, parsed.data);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'remote_agent.updated',
    targetType: 'remote_agent',
    targetId: id,
    payload: { name: existing.name, ...parsed.data },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const existing = getRemoteAgent(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const ok = deleteRemoteAgent(id);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'remote_agent.deleted',
    targetType: 'remote_agent',
    targetId: id,
    payload: { name: existing.name, sip_uri: existing.sip_uri },
  });
  return NextResponse.json({ ok });
}
