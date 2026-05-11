import { NextRequest, NextResponse } from 'next/server';
import { getDialIntentByCorrelationId } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Iter 95 — call-status poll for the softphone's "stuck connected"
 * defensive check. When sip.js misses a SIP BYE (transient WS
 * drop, proxy hiccup, etc.) the agent's UI keeps showing
 * "Connected" forever even though FS has long since torn the
 * channel down.
 *
 * The softphone polls this endpoint every 3 s with the
 * correlation_id we returned from /api/agent/dial. We look the
 * matching dial_intent up and answer:
 *   { hung_up: false } — call still in flight per the DB
 *   { hung_up: true,  cause: 'NORMAL_CLEARING' } — clear the UI
 *
 * Auth scoped to the agent who placed the call; admins can poll
 * any correlation_id for diagnostics.
 */
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const correlationId = url.searchParams.get('correlation_id');
  if (!correlationId) {
    return NextResponse.json(
      { error: 'correlation_id required' },
      { status: 400 },
    );
  }
  const row = getDialIntentByCorrelationId(correlationId);
  if (!row) {
    // Either the row hasn't been inserted yet (race), or it's
    // garbage-collected (campaign deleted). Treat as "unknown"
    // and let the client keep polling for a few cycles — sip.js
    // will eventually receive the BYE in the common case.
    return NextResponse.json({ hung_up: false, unknown: true });
  }
  if (me.role !== 'admin' && row.assigned_user_id !== me.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (row.hangup_at) {
    return NextResponse.json({
      hung_up: true,
      cause: row.hangup_cause ?? 'UNKNOWN',
      hangup_at: row.hangup_at,
    });
  }
  return NextResponse.json({
    hung_up: false,
    answered_at: row.answered_at,
  });
}
