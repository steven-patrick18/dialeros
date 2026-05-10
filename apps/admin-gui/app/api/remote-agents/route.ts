import { NextRequest, NextResponse } from 'next/server';
import {
  RemoteAgentInputSchema,
  appendAudit,
  createRemoteAgent,
  listRemoteAgents,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ remote_agents: listRemoteAgents() });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = RemoteAgentInputSchema.safeParse(raw);
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
  const result = createRemoteAgent(parsed.data);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'remote_agent.created',
    targetType: 'remote_agent',
    targetId: result.id,
    payload: {
      name: parsed.data.name,
      sip_uri: parsed.data.sip_uri,
      lines: parsed.data.lines,
    },
  });
  return NextResponse.json({ ok: true, id: result.id });
}
