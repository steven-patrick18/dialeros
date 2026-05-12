import { NextRequest, NextResponse } from 'next/server';
import { searchTranscripts } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 138 — FTS5-backed transcript + summary search. Admin and
// supervisor only — transcripts contain customer audio content
// that's not appropriate for agents to query across.

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return NextResponse.json(
      { error: 'Admin or supervisor role required' },
      { status: 403 },
    );
  }
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) {
    return NextResponse.json({ hits: [], query: '' });
  }
  const limitParam = req.nextUrl.searchParams.get('limit');
  let limit = 50;
  if (limitParam) {
    const n = Number(limitParam);
    if (Number.isFinite(n) && n > 0 && n <= 200) limit = Math.floor(n);
  }
  return NextResponse.json({
    query: q,
    hits: searchTranscripts(q, limit),
  });
}
