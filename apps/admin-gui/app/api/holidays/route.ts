import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  insertHoliday,
  listHolidays,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 180 — Holidays list + create.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rows = JSON.parse(JSON.stringify(listHolidays())) as ReturnType<
    typeof listHolidays
  >;
  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin role required' },
      { status: 403 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const obj = body as { holiday_date?: unknown; name?: unknown };
  if (typeof obj.holiday_date !== 'string' || !DATE_RE.test(obj.holiday_date)) {
    return NextResponse.json(
      { error: 'holiday_date must be YYYY-MM-DD' },
      { status: 400 },
    );
  }
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const row = insertHoliday({
    holidayDate: obj.holiday_date,
    name: obj.name.trim(),
  });
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'holiday.upsert',
    targetType: 'holiday',
    targetId: String(row.id),
    payload: { holiday_date: row.holiday_date, name: row.name },
  });
  return NextResponse.json({ row: JSON.parse(JSON.stringify(row)) });
}
