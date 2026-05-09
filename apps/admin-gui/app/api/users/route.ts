import { NextRequest, NextResponse } from 'next/server';
import {
  CreateUserInputSchema,
  appendAudit,
  createUser,
  listUsers,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const url = new URL(req.url);
  const includeInactive = url.searchParams.get('include_inactive') === '1';
  const users = listUsers(includeInactive).map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    display_name: u.display_name,
    skill_tier: u.skill_tier,
    is_active: u.is_active === 1,
    created_at: u.created_at,
  }));
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = CreateUserInputSchema.safeParse(raw);
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

  try {
    const result = createUser(parsed.data);
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'user.created',
      targetType: 'user',
      targetId: result.id,
      payload: {
        username: parsed.data.username,
        role: parsed.data.role,
        skill_tier: parsed.data.skill_tier,
        via: 'admin_console',
      },
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to create user';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
