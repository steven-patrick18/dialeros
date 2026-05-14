import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  deleteOrg,
  getOrg,
  getOrgBySlug,
  updateOrg,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 181 — Single org: PATCH (name/slug/enabled), DELETE
// (refuses on 'default' + on orgs with users still attached).

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
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
  const { id } = await ctx.params;
  if (!getOrg(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const obj = body as {
    name?: unknown;
    slug?: unknown;
    enabled?: unknown;
  };

  const updates: { name?: string; slug?: string; enabled?: boolean } = {};
  if (obj.name !== undefined) {
    if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
      return NextResponse.json({ error: 'name must be non-empty' }, { status: 400 });
    }
    updates.name = obj.name.trim();
  }
  if (obj.slug !== undefined) {
    if (typeof obj.slug !== 'string' || !SLUG_RE.test(obj.slug)) {
      return NextResponse.json({ error: 'slug invalid' }, { status: 400 });
    }
    const claimed = getOrgBySlug(obj.slug);
    if (claimed && claimed.id !== id) {
      return NextResponse.json({ error: 'slug already in use' }, { status: 409 });
    }
    updates.slug = obj.slug;
  }
  if (obj.enabled !== undefined) {
    if (typeof obj.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be boolean' }, { status: 400 });
    }
    if (id === 'default' && obj.enabled === false) {
      return NextResponse.json(
        { error: 'cannot disable the default org' },
        { status: 400 },
      );
    }
    updates.enabled = obj.enabled;
  }

  const ok = updateOrg(id, updates);
  if (!ok) {
    return NextResponse.json({ error: 'no changes' }, { status: 400 });
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'org.updated',
    targetType: 'org',
    targetId: id,
    payload: updates as Record<string, unknown>,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
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
  const { id } = await ctx.params;
  const result = deleteOrg(id);
  if (!result.ok) {
    const status =
      result.reason === 'not_found'
        ? 404
        : result.reason === 'default'
          ? 400
          : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'org.deleted',
    targetType: 'org',
    targetId: id,
    payload: {},
  });
  return NextResponse.json({ ok: true });
}
