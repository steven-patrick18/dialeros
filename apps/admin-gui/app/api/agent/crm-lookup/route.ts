import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  crmLookupByPhone,
  getEnabledCrmProvider,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';
import { createHash } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 185 — Agent-facing CRM lookup proxy. The agent's browser
// POSTs { phone }; we resolve the org's enabled provider, hit
// the provider API with the decrypted key (server-side ONLY),
// and return sanitized contact info. Audit-event per call.
// Phone is hashed in the audit payload — not stored raw — so
// the audit log stays clean of PII.

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const obj = body as { phone?: unknown };
  if (typeof obj.phone !== 'string' || obj.phone.length < 4) {
    return NextResponse.json({ error: 'phone required' }, { status: 400 });
  }

  // No provider configured → 404 with a quiet response so the
  // agent UI can hide the lookup button silently.
  const provider = getEnabledCrmProvider(me.org_id);
  if (!provider) {
    return NextResponse.json(
      { error: 'no_enabled_provider' },
      { status: 404 },
    );
  }

  const result = await crmLookupByPhone(me.org_id, obj.phone);

  // Phone hash for audit — first 12 chars of sha256, never the
  // raw number. Keeps the audit log useful (correlate calls
  // to lookups) without spraying PII.
  const phoneHash = createHash('sha256')
    .update(obj.phone)
    .digest('hex')
    .slice(0, 12);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'crm.lookup',
    targetType: 'crm_provider',
    targetId: provider.id,
    payload: {
      phone_hash: phoneHash,
      found: result.found,
      provider_status: result.provider_status ?? null,
      provider_error: result.provider_error ?? null,
    },
  });
  return NextResponse.json(result);
}
