import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  getAgentStatus,
  getWrapupEnforcementEnabled,
  latestUndisposedIntentForUser,
  pauseAgent,
  resumeAgent,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 40 — agent presence: AVAILABLE ↔ PAUSED. The pacer's
// pickAgent skips PAUSED agents so they don't get pulled into a
// live bridge while they're stepped away.

const PostBody = z.object({
  status: z.enum(['AVAILABLE', 'PAUSED']),
  reason: z.string().max(120).optional(),
});

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(getAgentStatus(me.id));
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = PostBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }
  if (parsed.data.status === 'PAUSED') {
    pauseAgent(me.id, parsed.data.reason ?? null);
  } else {
    // Iter 163 — wrap-up enforcement. Only an answered call without
    // a disposition counts as "stuck in wrap-up"; an unanswered
    // outbound that ended at NO_ANSWER auto-dispositions to NA via
    // iter 146. Allow agents to override with ?force=1 (admin path
    // for stuck rows that fs-events never closed).
    const force = req.nextUrl.searchParams.get('force') === '1';
    if (getWrapupEnforcementEnabled() && !force) {
      const stuck = latestUndisposedIntentForUser(me.id);
      if (stuck && stuck.answered_at) {
        return NextResponse.json(
          {
            error: 'wrapup_required',
            message:
              'Disposition your last connected call before going AVAILABLE.',
            intent_id: stuck.id,
            campaign_name: stuck.campaign_name,
            lead_name: stuck.lead_name ?? null,
            phone: stuck.transformed_phone ?? stuck.phone ?? null,
          },
          { status: 409 },
        );
      }
    }
    resumeAgent(me.id);
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action:
      parsed.data.status === 'PAUSED' ? 'agent.paused' : 'agent.resumed',
    targetType: 'user',
    targetId: me.id,
    payload: { reason: parsed.data.reason ?? null },
  });
  return NextResponse.json(getAgentStatus(me.id));
}
