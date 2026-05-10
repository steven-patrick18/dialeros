import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  getCarrier,
  normalizePhone,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';
import { originate } from '@/lib/esl';
import { gatewayNameFor } from '@/lib/freeswitch-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 31 — place a single test call via a chosen carrier.
//
// What "test" means:
//   - app=echo      — the answering side hears their own audio echoed
//                     back, useful to confirm 2-way audio + carrier path
//   - app=playback  — FS plays a 2s 440/480 Hz dial-tone-ish loop, useful
//                     when the called party can't speak back
//   - app=park      — leaves the leg parked; useful for transferring to
//                     an agent. Without an agent, the leg sits silent
//                     until hangup.
const TestCallBody = z.object({
  carrier_id: z.string().uuid(),
  to: z.string().min(4).max(40),
  cid: z.string().min(0).max(40).optional(),
  app: z.enum(['echo', 'playback', 'park', 'amd-detect']).default('echo'),
  timeout_seconds: z.number().int().min(5).max(120).default(30),
});

const APP_DIAL: Record<'echo' | 'playback' | 'park' | 'amd-detect', string> = {
  echo: '&echo',
  playback: '&playback(tone_stream://%(2000,4000,440,480))',
  park: '&park',
  // Iter 35 — answering-machine detection. amd_v2 listens for ~3s after
  // answer and decides HUMAN/MACHINE/UNSURE, sets variable_amd_result,
  // then breaks the call. The result lands in /api/telephony/calls/[uuid]
  // via uuid_dump (live) or in CHANNEL_HANGUP_COMPLETE for fs-events
  // pickup.
  'amd-detect': '&amd_v2(break_on_machine,async:false)',
};

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = TestCallBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }
  const { carrier_id, to, cid, app, timeout_seconds } = parsed.data;

  const carrier = getCarrier(carrier_id);
  if (!carrier) {
    return NextResponse.json({ error: 'Carrier not found.' }, { status: 404 });
  }

  const dest = normalizePhone(to);
  if (!dest) {
    return NextResponse.json(
      { error: 'Destination phone format is invalid.' },
      { status: 400 },
    );
  }
  const cidNorm = cid ? normalizePhone(cid) : null;
  if (cid && !cidNorm) {
    return NextResponse.json(
      { error: 'CID phone format is invalid.' },
      { status: 400 },
    );
  }

  const gateway = gatewayNameFor(carrier);
  let uuid: string;
  try {
    uuid = await originate({
      gateway,
      destination: dest,
      callerIdNumber: cidNorm ?? undefined,
      app: APP_DIAL[app],
      originateTimeout: timeout_seconds,
    });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'telephony.test_call_failed',
      targetType: 'carrier',
      targetId: carrier.id,
      payload: { to: dest, app, error: err.message ?? 'unknown' },
    });
    return NextResponse.json(
      {
        ok: false,
        error: err.message ?? 'originate failed',
        code: err.code ?? 'unknown',
        gateway,
        to: dest,
      },
      { status: 502 },
    );
  }

  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'telephony.test_call_placed',
    targetType: 'carrier',
    targetId: carrier.id,
    payload: { uuid, to: dest, app, cid: cidNorm },
  });

  return NextResponse.json({
    ok: true,
    uuid,
    gateway,
    to: dest,
    cid: cidNorm,
    app,
  });
}
