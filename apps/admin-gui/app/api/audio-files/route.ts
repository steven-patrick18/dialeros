import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  AUDIO_LIBRARY_ROOT,
  AudioFileMetaSchema,
  appendAudit,
  audioFilePath,
  listAudioFiles,
  newAudioFileId,
  registerAudioFile,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 150 — Sound Board API.
// GET    /api/audio-files            list (?category=menu_prompt filter)
// POST   /api/audio-files            create. multipart/form-data with
//                                    fields: name, description, category,
//                                    source ('uploaded'|'recorded'), file.
//
// Files are converted to FreeSWITCH-friendly 8kHz mono PCM .wav at
// upload time. The original bytes are discarded after conversion —
// keeping both copies bloats disk and complicates retention.
//
// Admin-only on writes. Anyone authenticated can read the catalogue
// (the call-menu form picker needs the list).

const FFMPEG_BIN = process.env.FFMPEG_BIN || '/usr/bin/ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_BIN || '/usr/bin/ffprobe';
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const category = req.nextUrl.searchParams.get('category') || undefined;
  return NextResponse.json({
    files: listAudioFiles(
      // narrow string to AudioCategory at the storage layer; if the
      // operator passes nonsense we just fall through to all-files.
      (category as Parameters<typeof listAudioFiles>[0]) ?? undefined,
    ),
  });
}

export async function POST(req: NextRequest) {
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

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json(
      { error: 'Content-Type must be multipart/form-data' },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return NextResponse.json(
      { error: `form parse: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json(
      { error: 'file field required (binary audio)' },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `file too large (max ${MAX_UPLOAD_BYTES} bytes)` },
      { status: 413 },
    );
  }

  const parsed = AudioFileMetaSchema.safeParse({
    name: form.get('name') ?? '',
    description: form.get('description') ?? '',
    category: form.get('category') ?? 'menu_prompt',
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const source =
    (form.get('source') as string | null) === 'recorded'
      ? 'recorded'
      : 'uploaded';

  // Write the raw upload to /tmp first, then ffmpeg-normalize to the
  // library path. ffmpeg can't read directly from a stream piped on
  // stdin if the input has no header it can identify; safest path
  // is always to land it on disk first.
  const id = newAudioFileId();
  const tmpInput = `/tmp/audio-upload-${id}`;
  const targetPath = audioFilePath(id);

  try {
    await mkdir(dirname(targetPath), { recursive: true });
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(tmpInput, buf);

    // Normalize via ffmpeg:
    //   -y                     overwrite output without prompting
    //   -i tmpInput            source
    //   -ar 8000               sample rate FS prefers for IVR
    //   -ac 1                  mono
    //   -acodec pcm_s16le      signed-16-bit little-endian PCM
    //   -f wav                 .wav container
    await runProcess(FFMPEG_BIN, [
      '-y',
      '-i', tmpInput,
      '-ar', '8000',
      '-ac', '1',
      '-acodec', 'pcm_s16le',
      '-f', 'wav',
      targetPath,
    ]);

    const st = await stat(targetPath);
    const durationMs = await probeDurationMs(targetPath);

    registerAudioFile({
      id,
      name: parsed.data.name,
      description: parsed.data.description,
      category: parsed.data.category,
      source,
      duration_ms: durationMs,
      size_bytes: st.size,
      created_by_user_id: me.id,
    });

    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'audio_file.create',
      targetType: 'audio_file',
      targetId: id,
      payload: {
        name: parsed.data.name,
        category: parsed.data.category,
        source,
        size_bytes: st.size,
      },
    });

    return NextResponse.json(
      { id, path: targetPath, size_bytes: st.size, duration_ms: durationMs },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  } finally {
    // Best-effort cleanup of the temp input.
    try {
      await unlink(tmpInput);
    } catch {
      /* ignore */
    }
  }
}

function runProcess(
  bin: string,
  args: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      // Cap stderr buffer at 64KB so a runaway logger can't OOM us.
      if (stderr.length > 65536) {
        stderr = stderr.slice(stderr.length - 65536);
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${bin} exited ${code}: ${stderr.trim().slice(0, 800)}`,
          ),
        );
    });
  });
}

async function probeDurationMs(path: string): Promise<number | null> {
  return new Promise((resolve) => {
    const proc = spawn(FFPROBE_BIN, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      path,
    ]);
    let out = '';
    proc.stdout.on('data', (c: Buffer) => {
      out += c.toString();
    });
    proc.on('close', () => {
      const seconds = parseFloat(out.trim());
      if (!Number.isFinite(seconds)) resolve(null);
      else resolve(Math.round(seconds * 1000));
    });
    proc.on('error', () => resolve(null));
  });
}
