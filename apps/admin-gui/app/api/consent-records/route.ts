import { NextRequest, NextResponse } from 'next/server';
import {
  ConsentRecordInputSchema,
  appendAudit,
  createConsentRecord,
  listConsentRecords,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 168 — Consent records collection.
//   GET  ?phone=...&active_only=1  search by phone
//   GET                            recent records (limit 200)
//   POST                            admin-only create

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const records = listConsentRecords({
    phone: sp.get('phone') || undefined,
    active_only: sp.get('active_only') === '1',
    limit: Number(sp.get('limit') || 200),
  });
  return NextResponse.json({ records });
}

export async function POST(req: NextRequest) {
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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = ConsentRecordInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const result = createConsentRecord(parsed.data, {
    grantedByUserId: me.id,
  });
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'consent.created',
    targetType: 'consent_record',
    targetId: result.id,
    payload: {
      phone: parsed.data.phone,
      consent_type: parsed.data.consent_type,
      source: parsed.data.source,
    },
  });
  return NextResponse.json({ id: result.id }, { status: 201 });
}
