import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, normalize } from 'node:path';
import { getDialIntentById } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 55 — stream a call recording to the browser.
//
// Access: the admin role can play any recording; an agent can only
// play recordings of dial_intents that were assigned to them. Path
// is read from the dial_intent row and validated against a fixed
// root so a hostile `recording_path` can't escape into another
// directory.
//
// Supports HTTP Range so the <audio> seek bar works without
// downloading the whole file first.

const RECORDINGS_ROOT = '/var/lib/dialeros/recordings';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const intentId = Number(id);
  if (!Number.isInteger(intentId) || intentId <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  const intent = getDialIntentById(intentId);
  if (!intent || !intent.recording_path) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // Authz: admin → any; otherwise only if assigned to caller.
  if (me.role !== 'admin' && intent.assigned_user_id !== me.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Path safety: resolve and ensure it stays under RECORDINGS_ROOT.
  // record_session writes flat into /var/lib/dialeros/recordings so
  // any candidate must startWith the root after normalisation.
  const safePath = normalize(resolve(intent.recording_path));
  if (!safePath.startsWith(RECORDINGS_ROOT + '/')) {
    return NextResponse.json(
      { error: 'Recording path is outside the configured root.' },
      { status: 403 },
    );
  }

  let stats;
  try {
    stats = await stat(safePath);
  } catch {
    return NextResponse.json(
      { error: 'Recording file not on disk (still being written?)' },
      { status: 404 },
    );
  }
  const total = stats.size;

  // Range support — let the <audio> seek bar work.
  const range = req.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) {
      return new NextResponse(null, { status: 416 });
    }
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Number(m[2]) : total - 1;
    if (start >= total || end >= total || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` },
      });
    }
    const stream = createReadStream(safePath, { start, end });
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

  const stream = createReadStream(safePath);
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
