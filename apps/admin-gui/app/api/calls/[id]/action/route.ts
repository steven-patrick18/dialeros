import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  addDnc,
  appendAudit,
  getCallDetail,
  updateLead,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 160 — Per-call actions on /calls/[id].
//
// POST /api/calls/[id]/action  { action, callback_at?, reason? }
//
// Available actions (admin OR supervisor only; agent CAN'T because
// these are operationally heavy):
//
//   redial            Reset the lead's status to NEW so the pacer
//                     can dial it again on its next sweep. Audit
//                     trail records "manual redial requested".
//   send_to_dnc       Add the lead's phone to the DNC list AND
//                     set the lead's status to DNC. Two writes
//                     in one click — compliance-relevant.
//   mark_wrong_number Set status to BAD_NUMBER (matches the
//                     existing disposition mapping).
//   schedule_callback Set callback_at + status CALLBACK_SCHEDULED.
//                     Same shape as agent CALLBACK disposition;
//                     useful when a supervisor's reviewing a
//                     missed call and wants to queue it for retry.

const ActionSchema = z
  .object({
    action: z.enum([
      'redial',
      'send_to_dnc',
      'mark_wrong_number',
      'schedule_callback',
    ]),
    callback_at: z.string().datetime().optional(),
    reason: z.string().max(200).optional(),
  })
  .refine(
    (d) => d.action !== 'schedule_callback' || !!d.callback_at,
    {
      message: 'callback_at is required for schedule_callback',
      path: ['callback_at'],
    },
  );

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
  const intentId = Number(id);
  if (!Number.isInteger(intentId) || intentId <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  const call = getCallDetail(intentId);
  if (!call) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const ip = clientIp(req);

  try {
    switch (parsed.data.action) {
      case 'redial': {
        updateLead(call.lead_id, { status: 'NEW' });
        appendAudit({
          actorUserId: me.id,
          actorIp: ip,
          action: 'call.redial',
          targetType: 'dial_intent',
          targetId: String(intentId),
          payload: {
            lead_id: call.lead_id,
            reason: parsed.data.reason ?? null,
            phone: call.lead_phone,
          },
        });
        return NextResponse.json({ ok: true, lead_status: 'NEW' });
      }
      case 'send_to_dnc': {
        const res = addDnc(
          {
            phone: call.lead_phone,
            reason:
              parsed.data.reason ?? `manual from /calls/${intentId}`,
          },
          { actorUserId: me.id, actorIp: ip },
        );
        if ('error' in res) {
          return NextResponse.json({ error: res.error }, { status: 400 });
        }
        updateLead(call.lead_id, { status: 'DNC' });
        appendAudit({
          actorUserId: me.id,
          actorIp: ip,
          action: 'call.dnc',
          targetType: 'dial_intent',
          targetId: String(intentId),
          payload: {
            lead_id: call.lead_id,
            phone: res.phone,
            reason: parsed.data.reason ?? null,
          },
        });
        return NextResponse.json({
          ok: true,
          dnc_phone: res.phone,
          lead_status: 'DNC',
        });
      }
      case 'mark_wrong_number': {
        updateLead(call.lead_id, { status: 'BAD_NUMBER' });
        appendAudit({
          actorUserId: me.id,
          actorIp: ip,
          action: 'call.mark_wrong_number',
          targetType: 'dial_intent',
          targetId: String(intentId),
          payload: {
            lead_id: call.lead_id,
            phone: call.lead_phone,
            reason: parsed.data.reason ?? null,
          },
        });
        return NextResponse.json({ ok: true, lead_status: 'BAD_NUMBER' });
      }
      case 'schedule_callback': {
        updateLead(call.lead_id, {
          status: 'CALLBACK_SCHEDULED',
          callback_at: parsed.data.callback_at!,
        });
        appendAudit({
          actorUserId: me.id,
          actorIp: ip,
          action: 'call.schedule_callback',
          targetType: 'dial_intent',
          targetId: String(intentId),
          payload: {
            lead_id: call.lead_id,
            callback_at: parsed.data.callback_at,
            reason: parsed.data.reason ?? null,
          },
        });
        return NextResponse.json({
          ok: true,
          lead_status: 'CALLBACK_SCHEDULED',
          callback_at: parsed.data.callback_at,
        });
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
  return NextResponse.json({ error: 'unhandled' }, { status: 500 });
}
