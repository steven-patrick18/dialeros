import { NextRequest, NextResponse } from 'next/server';
import {
  CarrierUpdateInputSchema,
  appendAudit,
  deleteCarrier,
  getCarrier,
  getRoutePlansForCarrier,
  parseCodecs,
  updateCarrier,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const carrier = getCarrier(id);
  if (!carrier) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Never return the encrypted password to the client.
  return NextResponse.json({
    id: carrier.id,
    name: carrier.name,
    host: carrier.host,
    port: carrier.port,
    transport: carrier.transport,
    auth_mode: carrier.auth_mode,
    digest_username: carrier.digest_username,
    has_digest_password: !!carrier.digest_password_encrypted,
    ip_acl: carrier.ip_acl,
    codecs: parseCodecs(carrier),
    max_channels: carrier.max_channels,
    max_cps: carrier.max_cps,
    mos_threshold: carrier.mos_threshold,
    enabled: carrier.enabled === 1,
    created_at: carrier.created_at,
    updated_at: carrier.updated_at,
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const existing = getCarrier(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const usedBy = getRoutePlansForCarrier(id);
  if (usedBy.length > 0) {
    return NextResponse.json(
      {
        error: `Carrier is referenced by ${usedBy.length} route plan${usedBy.length === 1 ? '' : 's'}: ${usedBy.map((p) => p.name).join(', ')}. Delete those first.`,
      },
      { status: 409 },
    );
  }

  const deleted = deleteCarrier(id);
  if (!deleted) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }

  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'carrier.deleted',
    targetType: 'carrier',
    targetId: id,
    payload: { name: existing.name, host: existing.host },
  });

  return NextResponse.json({ ok: true });
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const existing = getCarrier(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = CarrierUpdateInputSchema.safeParse(raw);
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

  // Build a clean diff for audit (exclude raw passwords).
  const auditPayload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (k === 'digest_password') {
      if (v) auditPayload.digest_password_changed = true;
      continue;
    }
    if (v === undefined) continue;
    auditPayload[k] = v;
  }

  try {
    const ok = updateCarrier(id, parsed.data);
    if (!ok) {
      return NextResponse.json({ error: 'No changes applied' }, { status: 400 });
    }
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'carrier.updated',
      targetType: 'carrier',
      targetId: id,
      payload: auditPayload,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Update failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
