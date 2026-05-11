import { NextRequest, NextResponse } from 'next/server';
import {
  addCidsToGroup,
  appendAudit,
  getCidGroup,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST { numbers: string | string[] } — bulk-add numbers to the group.
 * Accepts a free-form blob (newlines / commas / whitespace) or a
 * pre-split array. Duplicate (group, number) pairs silently no-op.
 * Returns { inserted, rejected[] } so the UI can surface bad rows.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const group = getCidGroup(id);
  if (!group) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    numbers?: string | string[];
  };
  const raw = body.numbers;
  if (raw === undefined) {
    return NextResponse.json(
      { error: '"numbers" is required (string blob or string[])' },
      { status: 400 },
    );
  }
  try {
    const result = addCidsToGroup(id, raw);
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'cid_group.numbers_added',
      targetType: 'cid_group',
      targetId: id,
      payload: {
        inserted: result.inserted,
        rejected_count: result.rejected.length,
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Failed to add numbers';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
