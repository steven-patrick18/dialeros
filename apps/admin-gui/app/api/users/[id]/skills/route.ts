import { NextRequest, NextResponse } from 'next/server';
import {
  UserSkillsInputSchema,
  appendAudit,
  getUserById,
  getUserSkills,
  saveUserSkills,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 175 — Per-user skill set.
// GET — any authenticated user (admin pages, agents fetching
//       their own skills for a future "what am I eligible for"
//       UI). Returns just the skill list.
// PUT — admin only. Replace-all.

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!getUserById(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ skills: getUserSkills(id) });
}

export async function PUT(
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
  if (!getUserById(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const skillsField = (body as { skills?: unknown })?.skills ?? body;
  const parsed = UserSkillsInputSchema.safeParse(skillsField);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const result = saveUserSkills(id, parsed.data);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'user_skills.saved',
    targetType: 'user',
    targetId: id,
    payload: { count: result.count, skills: parsed.data },
  });
  return NextResponse.json({
    ok: true,
    count: result.count,
    skills: getUserSkills(id),
  });
}
