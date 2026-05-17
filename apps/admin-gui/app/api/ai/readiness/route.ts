import { NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import {
  aiBindingCounts,
  evaluateAiReadiness,
  getAiLiveEnabled,
  listAiPersonas,
  probeAiStack,
  EMBED_MODEL,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { eslApi } from '@/lib/esl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 208 — AI stack readiness preflight. Gathers the probe
// (Ollama + models, Coqui, whisper-cli on disk, mod_audio_stream
// via ESL, the live switch, persona binding) and runs the pure
// evaluator. Read-only; admin gated. Drives the operator
// checklist on the Master AI page.

const WHISPER_CLI =
  process.env.WHISPER_CLI ?? '/usr/local/bin/whisper-cli';

export async function GET() {
  const me = await getCurrentUser();
  if (!me)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (me.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin role required' },
      { status: 403 },
    );
  }

  const stack = await probeAiStack();

  let audioForkLoaded = false;
  try {
    const out = await eslApi('module_exists mod_audio_stream', {
      timeoutMs: 1500,
    });
    audioForkLoaded = out.trim() === 'true';
  } catch {
    audioForkLoaded = false;
  }

  // Single-org box: listAiPersonas() defaults to the 'default'
  // org, which is what runs here.
  const personas = listAiPersonas();
  const llmModelsConfigured = [
    ...new Set(
      personas
        .filter((p) => p.enabled)
        .map((p) => p.llm_model)
        .filter((m): m is string => typeof m === 'string' && !!m),
    ),
  ];
  const counts = aiBindingCounts();

  const report = evaluateAiReadiness({
    ollamaUp: stack.ollama.up,
    models: stack.ollama.models,
    llmModelsConfigured,
    embedModel: EMBED_MODEL,
    coquiUp: stack.coqui.up,
    whisperCliPresent: existsSync(WHISPER_CLI),
    audioForkLoaded,
    aiLiveEnabled: getAiLiveEnabled(),
    enabledPersonaCount: counts.enabled_personas,
    boundPersonaCount: counts.bound_personas,
  });
  return NextResponse.json(report);
}
