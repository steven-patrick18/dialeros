// Iter 208 — AI stack readiness preflight. Pure evaluator:
// given a probe snapshot of the local AI stack, produce an
// ordered operator checklist (ok / blocked / warn) with the
// EXACT remediation per item + an overall armed verdict. This
// makes the standing honest boundary ("AI is inert until the
// operator wires the stack") concrete and actionable instead of
// buried in commit messages.
//
// Pure + deterministic — the verdict is the contract, so it is
// exhaustively tested. The probe gathering (Ollama, ESL, fs,
// db) lives in the route; this module never does I/O.

export type AiCheckStatus = 'ok' | 'blocked' | 'warn';

export interface AiReadinessProbe {
  ollamaUp: boolean;
  models: string[]; // ollama /api/tags names
  llmModelsConfigured: string[]; // distinct enabled-persona llm_model
  embedModel: string; // configured embed model (e.g. all-minilm)
  coquiUp: boolean;
  whisperCliPresent: boolean;
  audioForkLoaded: boolean; // mod_audio_stream in FreeSWITCH
  aiLiveEnabled: boolean;
  enabledPersonaCount: number;
  boundPersonaCount: number;
}

export interface AiReadinessItem {
  key: string;
  label: string;
  status: AiCheckStatus;
  detail: string;
  remediation: string; // '' when ok
  required: boolean; // a failing required item => not armed
}

export interface AiReadinessReport {
  armed: boolean; // every REQUIRED item ok (stack can take calls)
  live: boolean; // operator master switch state
  blockers: number;
  warnings: number;
  summary: string;
  items: AiReadinessItem[];
}

/** Ollama tag-name match tolerant of an implicit/explicit tag:
 * "qwen2.5:3b" matches "qwen2.5:3b" / "qwen2.5:3b:latest";
 * "all-minilm" matches "all-minilm" / "all-minilm:latest". */
export function modelPresent(
  models: string[],
  name: string,
): boolean {
  if (!Array.isArray(models) || typeof name !== 'string' || !name) {
    return false;
  }
  const ci = name.indexOf(':');
  const base = ci >= 0 ? name.slice(0, ci) : name;
  return models.some(
    (m) =>
      typeof m === 'string' &&
      (m === name || m === base || m.startsWith(base + ':')),
  );
}

export function evaluateAiReadiness(
  p: AiReadinessProbe,
): AiReadinessReport {
  const items: AiReadinessItem[] = [];

  // 1. Ollama transport — required.
  items.push({
    key: 'ollama',
    label: 'Ollama (local LLM) reachable',
    status: p.ollamaUp ? 'ok' : 'blocked',
    detail: p.ollamaUp
      ? `up, ${p.models.length} model(s) pulled`
      : 'not reachable on 127.0.0.1:11434',
    remediation: p.ollamaUp
      ? ''
      : 'Run scripts/install-ai-stack.sh, then: systemctl start ollama',
    required: true,
  });

  // 2. Persona LLM model(s) pulled — required iff any configured.
  const missingLlm = p.llmModelsConfigured.filter(
    (mm) => !modelPresent(p.models, mm),
  );
  if (p.llmModelsConfigured.length === 0) {
    items.push({
      key: 'llm_model',
      label: 'Persona LLM model pulled',
      status: 'warn',
      detail: 'no enabled persona yet - nothing to check',
      remediation: 'Create + enable an AI persona (it sets the model)',
      required: false,
    });
  } else {
    const ok = p.ollamaUp && missingLlm.length === 0;
    items.push({
      key: 'llm_model',
      label: 'Persona LLM model pulled',
      status: ok ? 'ok' : 'blocked',
      detail: ok
        ? `${p.llmModelsConfigured.join(', ')} present`
        : `missing: ${missingLlm.join(', ') || '(ollama down)'}`,
      remediation: ok
        ? ''
        : missingLlm.map((mm) => `ollama pull ${mm}`).join('; ') ||
          'start ollama',
      required: true,
    });
  }

  // 3. Embed model — warn (RAG degrades gracefully without it).
  const embedOk = p.ollamaUp && modelPresent(p.models, p.embedModel);
  items.push({
    key: 'embed_model',
    label: 'Embedding model pulled (RAG / learning)',
    status: embedOk ? 'ok' : 'warn',
    detail: embedOk
      ? `${p.embedModel} present`
      : `${p.embedModel} not pulled - retrieval / learning inert`,
    remediation: embedOk ? '' : `ollama pull ${p.embedModel}`,
    required: false,
  });

  // 4. Whisper STT — required.
  items.push({
    key: 'whisper',
    label: 'Whisper STT binary present',
    status: p.whisperCliPresent ? 'ok' : 'blocked',
    detail: p.whisperCliPresent
      ? 'whisper-cli found'
      : 'whisper-cli not found - callers cannot be transcribed',
    remediation: p.whisperCliPresent
      ? ''
      : 'Build whisper.cpp via scripts/install-ai-stack.sh',
    required: true,
  });

  // 5. Coqui TTS — required.
  items.push({
    key: 'coqui',
    label: 'Coqui XTTS daemon reachable',
    status: p.coquiUp ? 'ok' : 'blocked',
    detail: p.coquiUp
      ? 'up on 127.0.0.1:11123'
      : 'not reachable - the AI cannot speak',
    remediation: p.coquiUp
      ? ''
      : 'Start the Coqui XTTS-v2 daemon (127.0.0.1:11123)',
    required: true,
  });

  // 6. mod_audio_stream — required (THE recurring boundary).
  items.push({
    key: 'audio_fork',
    label: 'FreeSWITCH mod_audio_stream loaded',
    status: p.audioForkLoaded ? 'ok' : 'blocked',
    detail: p.audioForkLoaded
      ? 'module loaded'
      : 'not loaded - NO call audio can reach the AI loop',
    remediation: p.audioForkLoaded
      ? ''
      : 'Run scripts/install-audio-fork.sh, then reload FreeSWITCH',
    required: true,
  });

  // 7. Persona binding — warn (capability is fine; it just
  //    won't route anywhere until a persona is bound).
  let pbStatus: AiCheckStatus = 'ok';
  let pbDetail = `${p.boundPersonaCount} enabled persona(s) bound`;
  let pbRem = '';
  if (p.boundPersonaCount === 0) {
    pbStatus = 'warn';
    if (p.enabledPersonaCount === 0) {
      pbDetail = 'no enabled persona';
      pbRem = 'Create + enable an AI persona';
    } else {
      pbDetail = `${p.enabledPersonaCount} enabled but none bound`;
      pbRem = 'Assign a persona to an AI-agent user or a campaign';
    }
  }
  items.push({
    key: 'persona_bound',
    label: 'An enabled persona is bound',
    status: pbStatus,
    detail: pbDetail,
    remediation: pbRem,
    required: false,
  });

  // 8. Master switch — warn, intentionally last (inert by design).
  items.push({
    key: 'master_switch',
    label: 'AI live switch on (ai.live_enabled)',
    status: p.aiLiveEnabled ? 'ok' : 'warn',
    detail: p.aiLiveEnabled
      ? 'AI live'
      : 'OFF - AI is intentionally inert until you flip it',
    remediation: p.aiLiveEnabled
      ? ''
      : 'Flip the Master AI live switch once every blocker is clear',
    required: false,
  });

  const blockers = items.filter(
    (it) => it.required && it.status !== 'ok',
  ).length;
  const warnings = items.filter((it) => it.status === 'warn').length;
  const armed = blockers === 0;
  const live = p.aiLiveEnabled === true;
  let summary: string;
  if (!armed) {
    summary = `${blockers} blocker(s) - AI cannot take calls yet`;
  } else if (live) {
    summary = 'LIVE - stack ready and the live switch is on';
  } else {
    summary = 'Stack ready - live switch OFF (inert by design)';
  }
  return { armed, live, blockers, warnings, summary, items };
}
