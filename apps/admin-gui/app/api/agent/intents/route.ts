import { NextRequest, NextResponse } from 'next/server';
import {
  countDialIntentsForUser,
  listDialIntentsForUser,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get('limit') ?? 100)),
  );

  return NextResponse.json({
    total: countDialIntentsForUser(user.id),
    intents: listDialIntentsForUser(user.id, limit),
  });
}
