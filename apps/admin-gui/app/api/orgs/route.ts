import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  countUsersPerOrg,
  getOrg,
  getOrgBySlug,
  insertOrg,
  listOrgs,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 181 — Orgs list + create. Admin-only.

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export async function GET() {
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
  const rows = JSON.parse(JSON.stringify(listOrgs())) as ReturnType<
    typeof listOrgs
  >;
  return NextResponse.json({ rows, counts: countUsersPerOrg() });
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
  const obj = body as { id?: unknown; slug?: unknown; name?: unknown };
  if (typeof obj.id !== 'string' || !ID_RE.test(obj.id)) {
    return NextResponse.json(
      { error: 'id must be lowercase alphanumeric + _-' },
      { status: 400 },
    );
  }
  if (typeof obj.slug !== 'string' || !SLUG_RE.test(obj.slug)) {
    return NextResponse.json(
      { error: 'slug must be lowercase alphanumeric + _-, max 32 chars' },
      { status: 400 },
    );
  }
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (getOrg(obj.id)) {
    return NextResponse.json(
      { error: 'org id already exists' },
      { status: 409 },
    );
  }
  if (getOrgBySlug(obj.slug)) {
    return NextResponse.json(
      { error: 'org slug already exists' },
      { status: 409 },
    );
  }
  const row = insertOrg({ id: obj.id, slug: obj.slug, name: obj.name.trim() });
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'org.created',
    targetType: 'org',
    targetId: row.id,
    payload: { slug: row.slug, name: row.name },
  });
  return NextResponse.json({ row: JSON.parse(JSON.stringify(row)) });
}
