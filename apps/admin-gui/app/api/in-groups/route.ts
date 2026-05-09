import { NextRequest, NextResponse } from 'next/server';
import {
  InGroupInputSchema,
  appendAudit,
  createInGroup,
  getInGroupDids,
  listInGroups,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const groups = listInGroups().map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    type: g.type,
    whitelist_mode: g.whitelist_mode,
    routing_strategy: g.routing_strategy,
    enabled: g.enabled === 1,
    did_count: getInGroupDids(g.id).length,
    created_at: g.created_at,
  }));
  return NextResponse.json({ in_groups: groups });
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
  const parsed = InGroupInputSchema.safeParse(raw);
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
    const result = createInGroup(parsed.data);
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'in_group.created',
      targetType: 'in_group',
      targetId: result.id,
      payload: {
        name: parsed.data.name,
        type: parsed.data.type,
        whitelist_mode: parsed.data.whitelist_mode,
      },
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Failed to create in-group';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
