import { NextRequest, NextResponse } from 'next/server';
import {
  CidGroupInputSchema,
  appendAudit,
  countCidsInGroup,
  createCidGroup,
  listCidGroups,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const groups = listCidGroups().map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    strategy: g.strategy,
    cid_count: countCidsInGroup(g.id),
    created_at: g.created_at,
  }));
  return NextResponse.json({ cid_groups: groups });
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
  const parsed = CidGroupInputSchema.safeParse(raw);
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
    const result = createCidGroup(parsed.data);
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'cid_group.created',
      targetType: 'cid_group',
      targetId: result.id,
      payload: {
        name: parsed.data.name,
        strategy: parsed.data.strategy,
      },
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Failed to create CID group';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
