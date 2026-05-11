import { NextRequest, NextResponse } from 'next/server';
import {
  LeadUpdateInputSchema,
  appendAudit,
  deleteLead,
  getLead,
  updateLead,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const lead = getLead(id);
  if (!lead) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(lead);
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin' && user.role !== 'supervisor') {
    return NextResponse.json(
      { error: 'Admin or supervisor role required' },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  const raw = await req.json().catch(() => ({}));
  const parsed = LeadUpdateInputSchema.safeParse(raw);
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
  const result = updateLead(id, parsed.data);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'lead.updated',
    targetType: 'lead',
    targetId: id,
    payload: parsed.data,
  });
  return NextResponse.json({ ok: true, changed: result.changed });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin role required' },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  const lead = getLead(id);
  if (!lead) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const ok = deleteLead(id);
  if (!ok) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'lead.deleted',
    targetType: 'lead',
    targetId: id,
    payload: { phone: lead.phone, list_id: lead.list_id },
  });
  return NextResponse.json({ ok: true });
}
