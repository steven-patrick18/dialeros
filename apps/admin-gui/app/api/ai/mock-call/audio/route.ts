import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import {
  getAiPerfConfig,
  getAiPersona,
  resolveTtsSpeed,
  runMockTurn,
  userHasPermission,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

// Iter 213/214 — AUDIO mock call, continuous + live. Two ops on
// one route:
//   greet=1  → no audio in; TTS the persona greeting (call open)
//   (default)→ mic blob → ffmpeg 16k WAV → whisper STT →
//              runMockTurn (REAL pipeline) → Coqui XTTS out
// Fully local; ephemeral. admin OR ai.manage.

const FFMPEG = process.env.FFMPEG_BIN || '/usr/bin/ffmpeg';
const WHISPER = process.env.WHISPER_BIN || '/usr/local/bin/whisper-cli';
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ||
  '/var/lib/dialeros/ai/models/ggml-base.en.bin';
const COQUI_URL =
  process.env.COQUI_TTS_URL || 'http://127.0.0.1:11123';
const MAX_BYTES = 25 * 1024 * 1024;

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
        : reject(
            new Error(`${bin} exited ${code}: ${err.trim().slice(0, 600)}`),
          ),
    );
  });
}

async function synth(
  text: string,
  persona: { tts_engine: string; tts_voice: string | null },
): Promise<string | null> {
  try {
    const speed = resolveTtsSpeed(getAiPerfConfig());
    const body: Record<string, unknown> = {
      text: text.slice(0, 2000),
      language: 'en',
    };
    if (persona.tts_engine === 'coqui' && persona.tts_voice) {
      body.speaker_wav = persona.tts_voice;
    }
    if (speed && speed !== 1.0) body.speed = speed;
    const tr = await fetch(`${COQUI_URL}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!tr.ok) return null;
    return Buffer.from(await tr.arrayBuffer()).toString('base64');
  } catch {
    return null;
  }
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
  const personaId = String(form.get('persona_id') ?? '').trim();
  const persona = personaId ? getAiPersona(personaId) : undefined;
  if (!persona) {
    return NextResponse.json(
      { error: 'persona not found' },
      { status: 404 },
    );
  }

  // ---- Call open: speak the greeting (no STT / LLM) ----
  if (form.get('greet')) {
    const audio = await synth(persona.greeting, persona);
    return NextResponse.json({
      ok: true,
      greeting: true,
      reply: persona.greeting,
      audio_wav_base64: audio,
      tts: audio ? 'ok' : 'unavailable',
    });
  }

  const file = form.get('audio');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'audio required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'audio too large (25 MB max)' },
      { status: 400 },
    );
  }
  let history: Array<{ role: string; text: string }> = [];
  try {
    const h = JSON.parse(String(form.get('history') ?? '[]'));
    if (Array.isArray(h)) {
      history = h
        .map((t) => ({
          role: String(t?.role ?? ''),
          text: String(t?.text ?? ''),
        }))
        .filter(
          (t) =>
            (t.role === 'caller' || t.role === 'ai') &&
            t.text.trim() !== '',
        )
        .slice(-32);
    }
  } catch {
    history = [];
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

  const id = randomUUID();
  const tmpIn = `/tmp/mockcall-${id}`;
  const wav = `/tmp/mockcall-${id}.wav`;
  const txt = `${wav}.txt`;

  try {
    await writeFile(tmpIn, Buffer.from(await file.arrayBuffer()));
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
        { ok: true, transcript: '', reply: '', silence: true },
      );
    }

    const turn = await runMockTurn({
      persona,
      history,
      callerText: transcript,
      scopeType,
      scopeId,
    });
    if (!turn.ok) {
      return NextResponse.json(
        { transcript, error: turn.detail ?? 'LLM failed', ms: turn.ms },
        { status: 502 },
      );
    }
    const audio = await synth(turn.reply, persona);
    return NextResponse.json({
      ok: true,
      transcript,
      reply: turn.reply,
      used_knowledge: turn.used_knowledge,
      ms: turn.ms,
      audio_wav_base64: audio,
      tts: audio ? 'ok' : 'unavailable',
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || 'audio mock failed' },
      { status: 500 },
    );
  } finally {
    await Promise.allSettled([unlink(tmpIn), unlink(wav), unlink(txt)]);
  }
}
