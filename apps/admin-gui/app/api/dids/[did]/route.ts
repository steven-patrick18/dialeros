import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  cloneDidSettings,
  getDidWithOwner,
  moveDid,
  removeDid,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchSchema = z.union([
  z.object({
    in_group_id: z.string().uuid(),
  }),
  z.object({
    clone_to: z.string().min(1),
  }),
]);

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ did: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { did } = await ctx.params;
  const decoded = decodeURIComponent(did);
  const row = getDidWithOwner(decoded);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ did: row });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ did: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { did } = await ctx.params;
  const decoded = decodeURIComponent(did);

  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Provide { in_group_id } to move, or { clone_to } to clone.' },
      { status: 400 },
    );
  }

  if ('clone_to' in parsed.data) {
    const r = cloneDidSettings(decoded, parsed.data.clone_to);
    if (!r.ok) {
      const status = r.error === 'source_not_found' ? 404 : 400;
      return NextResponse.json(
        { error: r.error, existingOwner: r.existingOwner },
        { status },
      );
    }
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'did.clone',
      targetType: 'did',
      targetId: r.did!,
      payload: { source: decoded },
    });
    return NextResponse.json({ ok: true, did: r.did });
  }

  const r = moveDid(decoded, parsed.data.in_group_id);
  if (!r.ok) {
    const status = r.error === 'did_not_found' ? 404 : 400;
    return NextResponse.json({ error: r.error }, { status });
  }
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'did.move',
    targetType: 'did',
    targetId: decoded,
    payload: { new_in_group_id: parsed.data.in_group_id },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ did: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { did } = await ctx.params;
  const decoded = decodeURIComponent(did);
  const ok = removeDid(decoded);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'did.delete',
    targetType: 'did',
    targetId: decoded,
    payload: {},
  });
  return NextResponse.json({ ok: true });
}
