import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  clearPacingThresholds,
  getPacingThresholds,
  setPacingThresholds,
  PACING_THRESHOLDS_DEFAULT,
  type PacingThresholdStep,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 134 — admin-tunable predictive-pacing curve. GET returns
// the active steps (resolved through the app_settings default
// fallback so a never-set deploy gets the iter-132 baseline).
// POST replaces; DELETE reverts to default.
//
// Admin-only — this changes how the dialer picks dial_level
// across every campaign so the blast radius matches "Carriers"
// editing, not a campaign-scoped knob.

const StepSchema = z.object({
  min_rate: z.number().min(0).max(1),
  dial_level: z.number().positive().max(100),
});
const PostBody = z.object({
  steps: z.array(StepSchema).min(2).max(10),
});

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    steps: getPacingThresholds(),
    defaults: PACING_THRESHOLDS_DEFAULT,
  });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = PostBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }
  try {
    setPacingThresholds(parsed.data.steps as PacingThresholdStep[]);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'invalid thresholds' },
      { status: 400 },
    );
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'settings.pacing_thresholds_updated',
    targetType: 'app_setting',
    targetId: 'pacing.recommendation_thresholds',
    payload: { steps: parsed.data.steps },
  });
  return NextResponse.json({ ok: true, steps: getPacingThresholds() });
}

export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  clearPacingThresholds();
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'settings.pacing_thresholds_reset',
    targetType: 'app_setting',
    targetId: 'pacing.recommendation_thresholds',
    payload: { reverted_to: PACING_THRESHOLDS_DEFAULT },
  });
  return NextResponse.json({ ok: true, steps: PACING_THRESHOLDS_DEFAULT });
}
