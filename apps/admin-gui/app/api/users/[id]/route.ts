import { NextRequest, NextResponse } from 'next/server';
import {
  UpdateUserInputSchema,
  appendAudit,
  deactivateUser,
  effectivePermissions,
  getUser,
  reactivateUser,
  updateUser,
  userHasPermission,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin' && me.id !== (await ctx.params).id) {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const u = getUser(id);
  if (!u) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    display_name: u.display_name,
    skill_tier: u.skill_tier,
    is_active: u.is_active === 1,
    manual_dial: u.manual_dial === 1,
    permissions: effectivePermissions(u),
    user_level: u.user_level,
    permissions_overridden: u.permissions !== null,
    created_at: u.created_at,
    updated_at: u.updated_at,
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Iter 43 — admin OR a non-admin user holding `users.modify`. The
  // role + permissions + password fields stay admin-only below to
  // prevent privilege escalation by anyone the admin granted basic
  // user-edit access to.
  if (me.role !== 'admin' && !userHasPermission(me, 'users.modify')) {
    return NextResponse.json(
      { error: 'users.modify permission required' },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  const target = getUser(id);
  if (!target) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Special action: ?action=reactivate
  const url = new URL(req.url);
  if (url.searchParams.get('action') === 'reactivate') {
    const ok = reactivateUser(id);
    if (ok) {
      appendAudit({
        actorUserId: me.id,
        actorIp: clientIp(req),
        action: 'user.reactivated',
        targetType: 'user',
        targetId: id,
        payload: { username: target.username },
      });
    }
    return NextResponse.json({ ok });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = UpdateUserInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
          .join('; '),
      },
      { status: 400 },
    );
  }

  // Iter 43 — privilege-escalation guard. Non-admin editors can change
  // soft fields (display_name, email, skill_tier, manual_dial) but not
  // role / password / permissions. Strip those silently rather than
  // 403'ing the whole request — the audit log still captures what the
  // editor actually changed.
  if (me.role !== 'admin') {
    delete parsed.data.role;
    delete parsed.data.password;
    delete parsed.data.permissions;
    delete parsed.data.user_level;
    delete parsed.data.is_ai_agent;
    delete parsed.data.ai_persona_id;
  }

  const result = updateUser(id, parsed.data);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  // Audit payload — never include the new password.
  const auditPayload: Record<string, unknown> = { username: target.username };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (k === 'password') {
      if (v) auditPayload.password_changed = true;
      continue;
    }
    if (v !== undefined) auditPayload[k] = v;
  }

  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'user.updated',
    targetType: 'user',
    targetId: id,
    payload: auditPayload,
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
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const target = getUser(id);
  if (!target) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // Don't let an admin lock themselves out by deactivating their own session.
  if (id === me.id) {
    return NextResponse.json(
      { error: 'You cannot deactivate yourself.' },
      { status: 409 },
    );
  }

  const result = deactivateUser(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'user.deactivated',
    targetType: 'user',
    targetId: id,
    payload: { username: target.username },
  });
  return NextResponse.json({ ok: true });
}
