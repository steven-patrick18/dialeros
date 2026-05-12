import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { appendAudit } from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';
import { eslApi } from '@/lib/esl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 118 — attended transfer, cancellation.
//
// Agent changes their mind during consult: hang up the consult
// leg and unhold the customer. The agent's softphone goes back
// to the original conversation seamlessly.
//
// Best-effort: we ignore the consult-kill error if the consult
// leg already hung up (target refused) but propagate unhold
// errors since the customer is still on MOH and needs an audible
// path back.

const Body = z.object({
  original_uuid: z.string().min(8).max(40),
  consult_uuid: z.string().min(8).max(40),
});

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }
  const { original_uuid, consult_uuid } = parsed.data;

  try {
    await eslApi(`uuid_kill ${consult_uuid}`);
  } catch {
    /* consult leg may already be down — proceed to unhold */
  }
  try {
    await eslApi(`uuid_phone_event ${original_uuid} unhold`);
  } catch (e) {
    return NextResponse.json(
      {
        error: `Could not unhold customer leg: ${(e as Error).message ?? 'unknown'}`,
      },
      { status: 502 },
    );
  }

  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'agent.transfer_cancelled',
    targetType: 'dial_intent',
    targetId: original_uuid,
    payload: { original_uuid, consult_uuid },
  });

  return NextResponse.json({ ok: true });
}
