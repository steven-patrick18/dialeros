import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import {
  appendAudit,
  chunkText,
  embed,
  EMBED_MODEL,
  insertAiMemory,
  sanitizeUploadName,
  trainingSource,
  trainingTitle,
  userHasPermission,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

// Iter 211 — audio training. Upload any audio file → ffmpeg
// normalizes to 16 kHz mono WAV → whisper-cli transcribes
// (fully local) → the transcript is chunked + embedded into
// scoped ai_memory the Worker retrieves (iter 204). admin OR
// ai.manage. Long files take a while on a CPU box — honest.

const FFMPEG = process.env.FFMPEG_BIN || '/usr/bin/ffmpeg';
const WHISPER = process.env.WHISPER_BIN || '/usr/local/bin/whisper-cli';
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ||
  '/var/lib/dialeros/ai/models/ggml-base.en.bin';
const MAX_BYTES = 40 * 1024 * 1024; // 40 MB

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c: Buffer) => {
      err += c.toString();
      if (err.length > 65536) err = err.slice(-65536);
    });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${bin} exited ${code}: ${err.trim().slice(0, 600)}`)),
    );
  });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (me.role !== 'admin' && !userHasPermission(me, 'ai.manage')) {
    return NextResponse.json(
      { error: 'ai.manage required' },
      { status: 403 },
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form)
    return NextResponse.json(
      { error: 'multipart/form-data required' },
      { status: 400 },
    );
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file must be 1 byte–40 MB (got ${file.size})` },
      { status: 400 },
    );
  }
  const stRaw = form.get('scope_type');
  const scopeType =
    stRaw === 'campaign' || stRaw === 'in_group'
      ? String(stRaw)
      : 'global';
  const scopeId =
    scopeType === 'global'
      ? ''
      : String(form.get('scope_id') ?? '').trim();
  if (scopeType !== 'global' && !scopeId) {
    return NextResponse.json(
      { error: 'scope_id required for that scope' },
      { status: 400 },
    );
  }
  const fname = sanitizeUploadName(file.name);

  const id = randomUUID();
  const tmpIn = `/tmp/train-audio-${id}`;
  const wav = `/tmp/train-audio-${id}.wav`;
  const txt = `${wav}.txt`;

  try {
    await writeFile(tmpIn, Buffer.from(await file.arrayBuffer()));
    // → 16 kHz mono PCM WAV (what whisper.cpp wants).
    await run(FFMPEG, [
      '-y',
      '-i',
      tmpIn,
      '-ar',
      '16000',
      '-ac',
      '1',
      '-acodec',
      'pcm_s16le',
      '-f',
      'wav',
      wav,
    ]);
    await run(WHISPER, [
      '-m',
      WHISPER_MODEL,
      '-f',
      wav,
      '-nt',
      '-l',
      'en',
      '--output-txt',
      '-of',
      wav,
    ]);
    const transcript = (await readFile(txt, 'utf8').catch(() => ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!transcript) {
      return NextResponse.json(
        { error: 'transcription produced no text (silent/unclear audio?)' },
        { status: 422 },
      );
    }
    const chunks = chunkText(transcript, 800);
    let stored = 0;
    let embedWarning: string | null = null;
    for (let idx = 0; idx < chunks.length; idx++) {
      const piece = chunks[idx] ?? '';
      if (!piece.trim()) continue;
      const e = await embed(piece);
      if (!e.ok && !embedWarning) embedWarning = e.detail;
      insertAiMemory({
        id: randomUUID(),
        scopeType,
        scopeId,
        kind: 'knowledge',
        title:
          chunks.length > 1
            ? `${trainingTitle('audio', fname)} (${idx + 1}/${chunks.length})`
            : trainingTitle('audio', fname),
        content: piece,
        embedding: e.ok ? e.vector : null,
        embedModel: e.ok ? EMBED_MODEL : null,
        source: trainingSource('audio', fname),
      });
      stored++;
    }
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'ai.trained',
      targetType: 'ai_memory',
      targetId: `${scopeType}:${scopeId}`,
      payload: {
        mode: 'audio',
        file: fname,
        chars: transcript.length,
        chunks: stored,
      },
    });
    return NextResponse.json({
      ok: true,
      stored,
      chars: transcript.length,
      embed_warning: embedWarning,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || 'audio training failed' },
      { status: 500 },
    );
  } finally {
    await Promise.allSettled([
      unlink(tmpIn),
      unlink(wav),
      unlink(txt),
    ]);
  }
}
