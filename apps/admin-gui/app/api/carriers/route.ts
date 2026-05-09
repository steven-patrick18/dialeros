import { NextRequest, NextResponse } from 'next/server';
import {
  CarrierInputSchema,
  appendAudit,
  createCarrier,
  listCarriers,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const carriers = listCarriers().map((c) => ({
    id: c.id,
    name: c.name,
    host: c.host,
    port: c.port,
    transport: c.transport,
    auth_mode: c.auth_mode,
    max_channels: c.max_channels,
    enabled: c.enabled === 1,
    created_at: c.created_at,
  }));
  return NextResponse.json({ carriers });
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
  const parsed = CarrierInputSchema.safeParse(raw);
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
    const result = createCarrier(parsed.data);
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'carrier.created',
      targetType: 'carrier',
      targetId: result.id,
      payload: {
        name: parsed.data.name,
        host: parsed.data.host,
        port: parsed.data.port,
        transport: parsed.data.transport,
        auth_mode: parsed.data.auth_mode,
        max_channels: parsed.data.max_channels,
      },
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Failed to create carrier';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
