import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import {
  AUDIO_LIBRARY_ROOT,
  AudioFileMetaSchema,
  appendAudit,
  audioFilePath,
  newAudioFileId,
  registerAudioFile,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 151 — TTS generation via local piper-tts (no external API).
//
// GET  — list available voices (.onnx files in piper-voices/) +
//        piper-installed status. Used by the Sound Board TTS card
//        to populate the voice picker.
// POST — { text, voice, name, description, category } -> generate
//        WAV via piper, normalize via ffmpeg (8kHz mono PCM — same
//        as upload pipeline), register in audio_files. Admin only.
//
// piper not installed -> GET returns { installed: false } so the
// UI can show "run sudo /opt/dialeros/scripts/install-piper-tts.sh".
// POST returns 503.

const PIPER_BIN = process.env.PIPER_BIN || '/usr/local/bin/piper';
const VOICES_DIR =
  process.env.PIPER_VOICES_DIR || '/var/lib/dialeros/ai/piper-voices';
const FFMPEG_BIN = process.env.FFMPEG_BIN || '/usr/bin/ffmpeg';

interface VoiceInfo {
  name: string;
  model_path: string;
}

async function listVoices(): Promise<VoiceInfo[]> {
  if (!existsSync(VOICES_DIR)) return [];
  const entries = await readdir(VOICES_DIR);
  return entries
    .filter((n) => n.endsWith('.onnx'))
    .map((n) => ({
      name: n.replace(/\.onnx$/, ''),
      model_path: `${VOICES_DIR}/${n}`,
    }));
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const installed = existsSync(PIPER_BIN);
  if (!installed) {
    return NextResponse.json({
      installed: false,
      install_command:
        'sudo /opt/dialeros/scripts/install-piper-tts.sh',
      voices: [],
    });
  }
  return NextResponse.json({
    installed: true,
    voices: await listVoices(),
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
  if (!existsSync(PIPER_BIN)) {
    return NextResponse.json(
      {
        error:
          'piper-tts not installed. Run: sudo /opt/dialeros/scripts/install-piper-tts.sh',
      },
      { status: 503 },
    );
  }

  let body: {
    text?: unknown;
    voice?: unknown;
    name?: unknown;
    description?: unknown;
    category?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const voice = typeof body.voice === 'string' ? body.voice : '';
  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }
  if (text.length > 1500) {
    return NextResponse.json(
      { error: 'text too long (max 1500 chars; split into multiple sounds)' },
      { status: 400 },
    );
  }
  if (!voice) {
    return NextResponse.json({ error: 'voice is required' }, { status: 400 });
  }

  const voices = await listVoices();
  const picked = voices.find((v) => v.name === voice);
  if (!picked) {
    return NextResponse.json(
      { error: `unknown voice "${voice}"` },
      { status: 400 },
    );
  }

  const meta = AudioFileMetaSchema.safeParse({
    name: body.name ?? '',
    description: body.description ?? '',
    category: body.category ?? 'menu_prompt',
  });
  if (!meta.success) {
    return NextResponse.json(
      { error: 'validation', details: meta.error.flatten() },
      { status: 400 },
    );
  }

  const id = newAudioFileId();
  const rawPath = `/tmp/tts-${id}.wav`;
  const targetPath = audioFilePath(id);

  try {
    // Pipe text -> piper -> raw.wav
    await runPiper(picked.model_path, text, rawPath);
    // Normalize: 8kHz mono PCM for FS IVR playback.
    await runProcess(FFMPEG_BIN, [
      '-y',
      '-i', rawPath,
      '-ar', '8000',
      '-ac', '1',
      '-acodec', 'pcm_s16le',
      '-f', 'wav',
      targetPath,
    ]);
    const st = await stat(targetPath);
    registerAudioFile({
      id,
      name: meta.data.name,
      // Tuck the TTS source text into description so the audit trail
      // remembers what we synthesized; this is a deliberate trade
      // to avoid widening audio_files schema in iter 151.
      description: meta.data.description
        ? `${meta.data.description} | tts(${voice}): ${text.slice(0, 100)}${text.length > 100 ? '…' : ''}`
        : `tts(${voice}): ${text.slice(0, 100)}${text.length > 100 ? '…' : ''}`,
      category: meta.data.category,
      source: 'tts',
      duration_ms: null,
      size_bytes: st.size,
      created_by_user_id: me.id,
    });
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'audio_file.tts',
      targetType: 'audio_file',
      targetId: id,
      payload: {
        name: meta.data.name,
        voice,
        text_len: text.length,
        size_bytes: st.size,
      },
    });
    return NextResponse.json({ id, path: targetPath, size_bytes: st.size });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  } finally {
    try {
      await unlink(rawPath);
    } catch {
      /* ignore */
    }
  }
}

function runPiper(
  modelPath: string,
  text: string,
  outPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      PIPER_BIN,
      ['--model', modelPath, '--output_file', outPath],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 32768) stderr = stderr.slice(stderr.length - 32768);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper exited ${code}: ${stderr.trim().slice(0, 400)}`));
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

function runProcess(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
      if (stderr.length > 32768) stderr = stderr.slice(stderr.length - 32768);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} exited ${code}: ${stderr.trim().slice(0, 400)}`));
    });
  });
}
