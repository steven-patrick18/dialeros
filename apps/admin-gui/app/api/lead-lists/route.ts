import { NextRequest, NextResponse } from 'next/server';
import {
  LeadListInputSchema,
  appendAudit,
  createLeadList,
  leadCountFor,
  listLeadLists,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const lists = listLeadLists().map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    status: l.status,
    lead_count: leadCountFor(l.id),
    created_at: l.created_at,
  }));
  return NextResponse.json({ lead_lists: lists });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = LeadListInputSchema.safeParse(raw);
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

  try {
    const result = createLeadList(parsed.data);
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'lead_list.created',
      targetType: 'lead_list',
      targetId: result.id,
      payload: { name: parsed.data.name },
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Failed to create lead list';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
