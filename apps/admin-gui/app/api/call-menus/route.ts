import { NextRequest, NextResponse } from 'next/server';
import {
  CallMenuInputSchema,
  appendAudit,
  createCallMenu,
  listCallMenus,
  getCallMenuOptions,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 149 — GET list / POST create.
// Admin only — call menus shape the inbound + drop routing for
// the whole floor, so they live behind the admin role like
// in-groups and route plans.

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // For the list we don't need every menu's option grid — the
  // detail page fetches that. But include the option count so the
  // list table can render "3 options" per row without a second
  // round trip.
  const menus = listCallMenus().map((m) => ({
    ...m,
    option_count: getCallMenuOptions(m.id).length,
  }));
  return NextResponse.json({ menus });
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
  const parsed = CallMenuInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const result = await createCallMenu(parsed.data);
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'call_menu.create',
      targetType: 'call_menu',
      targetId: result.id,
      payload: { name: parsed.data.name, options: parsed.data.options.length },
    });
    return NextResponse.json(
      { id: result.id, deploy: result.deploy },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
