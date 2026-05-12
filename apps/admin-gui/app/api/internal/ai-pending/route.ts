import { NextRequest, NextResponse } from 'next/server';
import { listAiPendingIntents } from '@dialeros/control-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 135 — pending list for an operator-configured AI worker
// to poll. Returns up to ?limit= (default 10) answered + recorded
// calls that haven't been processed yet. The worker would:
//   1. GET /api/internal/ai-pending?limit=5
//   2. For each row: download recording via /api/recordings/<id>
//      (with admin creds), run STT + LLM, then POST result back
//      to /api/internal/ai-process
//   3. Sleep, repeat
//
// Same shared-secret pattern as the other /api/internal/* hooks.

const INTERNAL_TOKEN = process.env.KAMAILIO_INBOUND_TOKEN ?? '';

function checkToken(req: NextRequest): boolean {
  if (!INTERNAL_TOKEN) return true; // dev — same warn path as inbound-route
  const presented = req.headers.get('x-inbound-token') ?? '';
  if (presented && presented === INTERNAL_TOKEN) return true;
  const auth = req.headers.get('authorization') ?? '';
  const m = /^Basic\s+(.+)$/i.exec(auth);
  if (m) {
    try {
      const decoded = Buffer.from(m[1]!, 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      const candidate = idx >= 0 ? decoded.slice(idx + 1) : decoded;
      if (candidate === INTERNAL_TOKEN) return true;
    } catch {
      /* malformed */
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!checkToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!INTERNAL_TOKEN) {
    // eslint-disable-next-line no-console
    console.warn(
      '[ai-pending] KAMAILIO_INBOUND_TOKEN not set — accepting unauthenticated requests',
    );
  }
  const limitParam = req.nextUrl.searchParams.get('limit');
  let limit = 10;
  if (limitParam) {
    const n = Number(limitParam);
    if (Number.isFinite(n) && n > 0 && n <= 200) limit = Math.floor(n);
  }
  return NextResponse.json({ pending: listAiPendingIntents(limit) });
}
