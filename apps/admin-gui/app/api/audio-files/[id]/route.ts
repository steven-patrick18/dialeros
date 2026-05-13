import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { resolve, normalize } from 'node:path';
import {
  AUDIO_LIBRARY_ROOT,
  appendAudit,
  deleteAudioFile,
  getAudioFile,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 150 — Sound Board item endpoint.
// GET    /api/audio-files/[id]   stream the .wav (for browser
//                                preview). Range support so the
//                                <audio> element seek bar works.
// DELETE /api/audio-files/[id]   admin only. Removes both the DB
//                                row and the file on disk. Calls
//                                that already reference the file
//                                (call_menus.prompt_path) just see
//                                a stale path; iter 153 wire-up
//                                will surface that.

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const row = getAudioFile(id);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const safe = normalize(resolve(row.path));
  if (!safe.startsWith(AUDIO_LIBRARY_ROOT + '/')) {
    return NextResponse.json(
      { error: 'Path outside library root' },
      { status: 403 },
    );
  }
  let st;
  try {
    st = await stat(safe);
  } catch {
    return NextResponse.json(
      { error: 'File missing on disk' },
      { status: 404 },
    );
  }
  const total = st.size;
  const range = req.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return new NextResponse(null, { status: 416 });
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Number(m[2]) : total - 1;
    if (start >= total || end >= total || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` },
      });
    }
    const stream = createReadStream(safe, { start, end });
    return new NextResponse(
      stream as unknown as ReadableStream<Uint8Array>,
      {
        status: 206,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=300',
        },
      },
    );
  }
  const stream = createReadStream(safe);
  return new NextResponse(stream as unknown as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(total),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300',
    },
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
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
  const { id } = await ctx.params;
  const row = getAudioFile(id);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const safe = normalize(resolve(row.path));
  if (!safe.startsWith(AUDIO_LIBRARY_ROOT + '/')) {
    return NextResponse.json(
      { error: 'Path outside library root' },
      { status: 403 },
    );
  }
  // Delete the disk file first; if that fails we keep the DB row
  // so the admin can retry. If the file's already missing (manual
  // unlink), the DB row gets removed anyway — no zombie left.
  try {
    await unlink(safe);
  } catch (e) {
    const msg = (e as NodeJS.ErrnoException).code;
    if (msg !== 'ENOENT') {
      return NextResponse.json(
        { error: `unlink: ${(e as Error).message}` },
        { status: 500 },
      );
    }
  }
  deleteAudioFile(id);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'audio_file.delete',
    targetType: 'audio_file',
    targetId: id,
    payload: { name: row.name },
  });
  return NextResponse.json({ ok: true });
}
