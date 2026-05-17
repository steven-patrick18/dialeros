import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  getAiPerfConfig,
  setAiPerfConfig,
  userHasPermission,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 207 — AI performance knobs (latency / quality). One JSON
// blob in app_settings. ai.manage gated. Defaults reproduce
// pre-207 behaviour exactly (see ai-perf.ts).

export async function GET() {
  const me = await getCurrentUser();
  if (!me)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json(
      { error: 'ai.manage required' },
      { status: 403 },
    );
  }
  return NextResponse.json({ config: getAiPerfConfig() });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json(
      { error: 'ai.manage required' },
      { status: 403 },
    );
  }
  const b = (await req.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const rl = b.reply_length;
  const cfg = {
    reply_length:
      rl === 'short' || rl === 'medium' || rl === 'long' || rl === 'uncapped'
        ? (rl as 'short' | 'medium' | 'long' | 'uncapped')
        : undefined,
    temperature:
      typeof b.temperature === 'number' ? b.temperature : undefined,
    keep_warm: b.keep_warm === true,
    num_ctx: typeof b.num_ctx === 'number' ? b.num_ctx : undefined,
    prompt_budget_chars:
      typeof b.prompt_budget_chars === 'number'
        ? b.prompt_budget_chars
        : undefined,
    tts_speed:
      typeof b.tts_speed === 'number' ? b.tts_speed : undefined,
  };
  setAiPerfConfig(cfg);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'ai.perf_config_set',
    targetType: 'app_settings',
    targetId: 'ai.perf_config',
    payload: cfg,
  });
  return NextResponse.json({ ok: true, config: getAiPerfConfig() });
}
