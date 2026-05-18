import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 216 — admin-only download of the generated guides. The
// filename is whitelisted (no path traversal); files live in
// the repo docs/ dir (../../docs from the admin-gui cwd).

const DOCS_DIR =
  process.env.DIALEROS_DOCS_DIR ??
  resolve(process.cwd(), '../../docs');

const ALLOWED = new Set([
  'DialerOS-Admin-Manual.pdf',
  'DialerOS-Presentation.pdf',
]);

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ file: string }> },
) {
  const me = await getCurrentUser();
  if (!me)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (me.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin role required' },
      { status: 403 },
    );
  }
  const { file } = await ctx.params;
  if (!ALLOWED.has(file)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const buf = await readFile(resolve(DOCS_DIR, file));
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${file}"`,
        'Content-Length': String(buf.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'document not generated yet' },
      { status: 404 },
    );
  }
}
