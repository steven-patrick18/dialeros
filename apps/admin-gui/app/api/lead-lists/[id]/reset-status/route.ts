import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  bulkResetLeadsInList,
  getLeadList,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  from_status: z.enum([
    'CALLED_NO_ANSWER',
    'BUSY',
    'CALLBACK_SCHEDULED',
    'CONVERTED',
    'DNC_TEMP',
    'BAD_NUMBER',
    'DIALING',
  ]),
});

/**
 * Iter 94 — bulk reset leads in this list whose status matches
 * from_status, putting them back to NEW + clearing last_called_at
 * so the cooldown gate doesn't keep them out. Admin / supervisor.
 *
 * Scope-limited to one list + one source status so an operator
 * can't accidentally nuke leads they're not looking at. Pair with
 * the lead list detail page's status drill-down: click
 * CALLED_NO_ANSWER → preview the rows → click Reset to bump them
 * back to NEW.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
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
  const { id } = await ctx.params;
  if (!getLeadList(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
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
  const reset = bulkResetLeadsInList(id, parsed.data.from_status);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'lead_list.bulk_reset',
    targetType: 'lead_list',
    targetId: id,
    payload: { from_status: parsed.data.from_status, reset },
  });
  return NextResponse.json({ ok: true, reset });
}
