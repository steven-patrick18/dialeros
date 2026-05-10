import { NextRequest, NextResponse } from 'next/server';
import {
  BulkDidInputSchema,
  SingleDidInputSchema,
  addDid,
  appendAudit,
  bulkAddDids,
  listAllDids,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ dids: listAllDids() });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));

  // Bulk vs single discriminated by which schema accepts the payload.
  const bulk = BulkDidInputSchema.safeParse(body);
  if (bulk.success) {
    const result = bulkAddDids(bulk.data);
    appendAudit({
      actorUserId: user.id,
      actorIp: clientIp(req),
      action: 'did.bulk_add',
      targetType: 'in_group',
      targetId: bulk.data.in_group_id,
      payload: {
        attempted: result.attempted,
        added: result.added.length,
        skipped: result.skipped.length,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  }

  const single = SingleDidInputSchema.safeParse(body);
  if (!single.success) {
    return NextResponse.json(
      {
        error:
          single.error.issues[0]?.message ??
          'Invalid DID input. Provide { did, in_group_id } or { dids[], in_group_id }.',
      },
      { status: 400 },
    );
  }
  const r = addDid(single.data);
  if (!r.ok) {
    const status = r.error === 'invalid_format' ? 400 : 409;
    return NextResponse.json(
      {
        error: r.error,
        existingOwner: r.existingOwner,
      },
      { status },
    );
  }
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'did.add',
    targetType: 'did',
    targetId: r.did!,
    payload: { in_group_id: single.data.in_group_id },
  });
  return NextResponse.json({ ok: true, did: r.did });
}
