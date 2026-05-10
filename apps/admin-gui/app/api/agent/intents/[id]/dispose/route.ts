import { NextRequest, NextResponse } from 'next/server';
import {
  DisposeInputSchema,
  disposeAgentIntent,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const intentId = Number(id);
  if (!Number.isInteger(intentId) || intentId <= 0) {
    return NextResponse.json({ error: 'Invalid intent id' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = DisposeInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const result = disposeAgentIntent({
    intentId,
    userId: user.id,
    ip: clientIp(req),
    input: parsed.data,
  });
  if (!result) {
    // Either the intent doesn't exist or it isn't assigned to this user.
    // Both are 404 from the agent's perspective — they have no business
    // knowing the difference.
    return NextResponse.json({ error: 'Intent not found' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    intent: result.intent,
    new_lead_status: result.newLeadStatus,
  });
}
