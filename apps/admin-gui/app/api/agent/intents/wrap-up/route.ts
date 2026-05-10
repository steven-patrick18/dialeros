import { NextResponse } from 'next/server';
import { latestUndisposedIntentForUser } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 46 — drives the wrap-up modal on the agent panel. Returns the
// most recent dial_intent assigned to the calling user that hasn't
// been dispositioned yet, or { intent: null } when there's nothing
// pending. The agent's softphone-panel hits this whenever a call
// ends so it can pin the agent to dispositioning before letting them
// take the next call.

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const intent = latestUndisposedIntentForUser(me.id);
  return NextResponse.json({ intent: intent ?? null });
}
