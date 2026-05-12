import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  cloneCampaign,
  getCampaign,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 128 — duplicate an existing campaign with all its
// operator-configurable settings, optionally carrying the lead-
// list attachments too. New campaign starts paused so it can be
// inspected before going live. Admin role only — cloning
// touches routing + dialable scope.

const Body = z.object({
  name: z.string().min(1).max(120),
  include_lead_lists: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin role required' },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  if (!getCampaign(id)) {
    return NextResponse.json(
      { error: 'Source campaign not found' },
      { status: 404 },
    );
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  try {
    const { id: cloneId } = cloneCampaign(id, parsed.data.name.trim(), {
      include_lead_lists: parsed.data.include_lead_lists ?? false,
    });
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'campaign.cloned',
      targetType: 'campaign',
      targetId: cloneId,
      payload: {
        source_id: id,
        new_name: parsed.data.name.trim(),
        include_lead_lists: parsed.data.include_lead_lists ?? false,
      },
    });
    return NextResponse.json({ ok: true, id: cloneId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'clone failed' },
      { status: 409 },
    );
  }
}
