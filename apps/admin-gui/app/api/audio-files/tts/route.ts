import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { existsSync } from 'node:fs';
import { readdir, stat, unlink, writeFile } from 'node:fs/promises';
import {
  AUDIO_LIBRARY_ROOT,
  AudioFileMetaSchema,
  appendAudit,
  audioFilePath,
  getAudioFile,
  newAudioFileId,
  registerAudioFile,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 151 — TTS via local piper-tts.
// Iter 162 — adds engine='coqui' option that talks to the
//            iter-162 Coqui daemon for XTTS-v2 voice cloning.
//
// GET  — returns capabilities of both engines.
//        { piper: { installed, voices[] },
//          coqui: { installed, model, supports_clone } }
// POST — { engine, text, voice|voice_clone_audio_id, name, ... }

const PIPER_BIN = process.env.PIPER_BIN || '/usr/local/bin/piper';
const PIPER_VOICES_DIR =
  process.env.PIPER_VOICES_DIR || '/var/lib/dialeros/ai/piper-voices';
const FFMPEG_BIN = process.env.FFMPEG_BIN || '/usr/bin/ffmpeg';
const COQUI_URL =
  process.env.COQUI_DAEMON_URL || 'http://127.0.0.1:11123';

interface PiperVoice {
  name: string;
  model_path: string;
}

async function listPiperVoices(): Promise<PiperVoice[]> {
  if (!existsSync(PIPER_VOICES_DIR)) return [];
  const entries = await readdir(PIPER_VOICES_DIR);
  return entries
    .filter((n) => n.endsWith('.onnx'))
    .map((n) => ({
      name: n.replace(/\.onnx$/, ''),
      model_path: `${PIPER_VOICES_DIR}/${n}`,
    }));
}

interface CoquiHealth {
  installed: boolean;
  loaded?: boolean;
  model?: string;
  uptime_s?: number;
  supports_clone?: boolean;
}

async function probeCoqui(): Promise<CoquiHealth> {
  try {
    const res = await fetch(`${COQUI_URL}/health`, {
      // Short timeout — if the daemon isn't running we want to
      // fall back to "installed: false" fast.
      signal: AbortSignal.timeout(800),
    });
    if (!res.ok) return { installed: false };
    const data = (await res.json()) as {
      ok: boolean;
      loaded: boolean;
      model: string;
      uptime_s: number;
    };
    return {
      installed: true,
      loaded: data.loaded,
      model: data.model,
      uptime_s: data.uptime_s,
      supports_clone: data.model?.includes('xtts'),
    };
  } catch {
    return { installed: false };
  }
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const piperInstalled = existsSync(PIPER_BIN);
  const coqui = await probeCoqui();
  return NextResponse.json({
    // Iter 151 — backwards-compat fields the existing UI expects:
    installed: piperInstalled,
    install_command: piperInstalled
      ? undefined
      : 'sudo /opt/dialeros/scripts/install-piper-tts.sh',
    voices: piperInstalled ? await listPiperVoices() : [],
    // Iter 162 — explicit engine status.
    engines: {
      piper: {
        installed: piperInstalled,
        install_command: piperInstalled
          ? undefined
          : 'sudo /opt/dialeros/scripts/install-piper-tts.sh',
        voices: piperInstalled ? await listPiperVoices() : [],
      },
      coqui,
    },
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

  let body: {
    engine?: unknown;
    text?: unknown;
    voice?: unknown;
    voice_clone_audio_id?: unknown;
    language?: unknown;
    name?: unknown;
    description?: unknown;
    category?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const engine = (typeof body.engine === 'string' ? body.engine : 'piper') as
    | 'piper'
    | 'coqui';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json(
      { error: 'text too long (max 2000 chars)' },
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
    if (engine === 'coqui') {
      if (!existsSync(PIPER_BIN)) {
        // (piper not required for coqui; this check is for the joint
        // tooling — keep it but don't block coqui-only deployments.)
      }
      const coquiStatus = await probeCoqui();
      if (!coquiStatus.installed) {
        return NextResponse.json(
          {
            error:
              'coqui daemon not reachable. Run: sudo /opt/dialeros/scripts/install-coqui-tts.sh + ' +
              'systemctl enable --now dialeros-coqui-tts',
          },
          { status: 503 },
        );
      }
      // Voice clone source: optional audio_files row whose disk
      // path we hand to the daemon as speaker_wav.
      let speakerWav: string | undefined;
      const cloneId =
        typeof body.voice_clone_audio_id === 'string'
          ? body.voice_clone_audio_id
          : null;
      if (cloneId) {
        const row = getAudioFile(cloneId);
        if (!row) {
          return NextResponse.json(
            { error: `voice_clone_audio_id not found: ${cloneId}` },
            { status: 400 },
          );
        }
        speakerWav = row.path;
      }
      const language =
        typeof body.language === 'string' && body.language.trim()
          ? body.language.trim()
          : 'en';
      const coquiRes = await fetch(`${COQUI_URL}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          language,
          ...(speakerWav ? { speaker_wav: speakerWav } : {}),
        }),
        // Generation can take 5-30s on CPU; give the daemon
        // a healthy timeout.
        signal: AbortSignal.timeout(120_000),
      });
      if (!coquiRes.ok) {
        const errText = await coquiRes.text().catch(() => '');
        return NextResponse.json(
          { error: `coqui daemon: ${errText || coquiRes.status}` },
          { status: 502 },
        );
      }
      const ab = await coquiRes.arrayBuffer();
      await writeFile(rawPath, Buffer.from(ab));
    } else {
      // engine === 'piper' (default)
      if (!existsSync(PIPER_BIN)) {
        return NextResponse.json(
          {
            error:
              'piper-tts not installed. Run: sudo /opt/dialeros/scripts/install-piper-tts.sh',
          },
          { status: 503 },
        );
      }
      const voices = await listPiperVoices();
      const voiceName =
        typeof body.voice === 'string' ? body.voice : '';
      const picked = voices.find((v) => v.name === voiceName);
      if (!picked) {
        return NextResponse.json(
          { error: `unknown piper voice "${voiceName}"` },
          { status: 400 },
        );
      }
      await runPiper(picked.model_path, text, rawPath);
    }

    // Normalize to FreeSWITCH-friendly 8kHz mono PCM .wav.
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
    const summary =
      engine === 'coqui'
        ? `tts(coqui xtts-v2): ${text.slice(0, 100)}${text.length > 100 ? '…' : ''}`
        : `tts(piper ${String(body.voice ?? 'unknown')}): ${text.slice(0, 100)}${text.length > 100 ? '…' : ''}`;
    registerAudioFile({
      id,
      name: meta.data.name,
      description: meta.data.description
        ? `${meta.data.description} | ${summary}`
        : summary,
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
        engine,
        voice: body.voice ?? null,
        voice_clone_audio_id:
          typeof body.voice_clone_audio_id === 'string'
            ? body.voice_clone_audio_id
            : null,
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
