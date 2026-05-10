import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { appendAudit } from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';
import { uuidDump, uuidKill } from '@/lib/esl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UuidSchema = z
  .string()
  .regex(/^[a-f0-9-]{32,40}$/i, 'Not a UUID');

/**
 * GET /api/telephony/calls/[uuid] — current channel state.
 *
 * Returns:
 *   { exists: false }
 *     channel is gone (hung up or never existed)
 *   { exists: true, state, duration_ms, amd_result?, ... }
 *     pulled from uuid_dump
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { uuid } = await ctx.params;
  const parsed = UuidSchema.safeParse(uuid);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid UUID' }, { status: 400 });
  }

  const dump = await uuidDump(parsed.data);
  if (!dump) {
    return NextResponse.json({ exists: false });
  }

  // Compute live duration in ms. Channel-Created is the channel's start
  // (microseconds since epoch). billsec is set once answered and ticks
  // until hangup.
  const billmsec = Number(dump['variable_billmsec'] ?? '0');
  const billsec = Number(dump['variable_billsec'] ?? '0');
  let durationMs = 0;
  if (Number.isFinite(billmsec) && billmsec > 0) {
    durationMs = Math.round(billmsec);
  } else if (Number.isFinite(billsec) && billsec > 0) {
    durationMs = billsec * 1000;
  } else {
    // Pre-answer: roughly compute since channel creation.
    const createdEpoch = Number(dump['Channel-Created-Time'] ?? '0');
    if (Number.isFinite(createdEpoch) && createdEpoch > 0) {
      durationMs = Math.max(0, Date.now() - Math.round(createdEpoch / 1000));
    }
  }

  return NextResponse.json({
    exists: true,
    uuid: parsed.data,
    state: dump['Channel-State'] ?? null,
    call_state: dump['Channel-Call-State'] ?? null,
    direction: dump['Channel-Direction'] ?? null,
    answered: !!dump['Caller-Channel-Answered-Time'] && dump['Caller-Channel-Answered-Time'] !== '0',
    duration_ms: durationMs,
    destination: dump['Caller-Destination-Number'] ?? null,
    cid_number: dump['Caller-Caller-ID-Number'] ?? null,
    amd_result: dump['variable_amd_result'] ?? null,
    amd_cause: dump['variable_amd_cause'] ?? null,
  });
}

/**
 * DELETE /api/telephony/calls/[uuid] — hang up the channel.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ uuid: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { uuid } = await ctx.params;
  const parsed = UuidSchema.safeParse(uuid);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid UUID' }, { status: 400 });
  }

  const ok = await uuidKill(parsed.data, 'MANAGER_REQUEST');
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'telephony.call_hangup',
    targetType: 'call',
    targetId: parsed.data,
    payload: { ok },
  });
  return NextResponse.json({ ok });
}
