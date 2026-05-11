import { NextRequest, NextResponse } from 'next/server';
import {
  DncInputSchema,
  addDnc,
  bulkAddDnc,
  countDnc,
  listDnc,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(
    1000,
    Math.max(1, Number(url.searchParams.get('limit') ?? 200)),
  );
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
  return NextResponse.json({
    total: countDnc(),
    phones: listDnc(limit, offset),
  });
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
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Bulk add: { phones: ['...', '...'], reason?: '...' }
  if (Array.isArray(raw.phones)) {
    const list = (raw.phones as unknown[]).map(String);
    const result = bulkAddDnc(list, {
      actorUserId: me.id,
      actorIp: clientIp(req),
      reason: typeof raw.reason === 'string' ? raw.reason : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  }

  // Single add: { phone, reason? }
  const parsed = DncInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }
  const result = addDnc(parsed.data, {
    actorUserId: me.id,
    actorIp: clientIp(req),
  });
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, phone: result.phone });
}
