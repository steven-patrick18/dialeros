import { NextRequest, NextResponse } from 'next/server';
import {
  NodeInputSchema,
  listNodesFromDb,
  provisionNode,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ nodes: listNodesFromDb() });
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
  const parsed = NodeInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      },
      { status: 400 },
    );
  }

  try {
    const result = await provisionNode(parsed.data, {
      actorUserId: user.id,
      actorIp: clientIp(req),
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Provisioning failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
