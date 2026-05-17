import { describe, expect, it } from 'vitest';
import {
  modelPresent,
  evaluateAiReadiness,
  type AiReadinessProbe,
} from '../src/ai-readiness';

const READY: AiReadinessProbe = {
  ollamaUp: true,
  models: ['qwen2.5:3b', 'all-minilm:latest'],
  llmModelsConfigured: ['qwen2.5:3b'],
  embedModel: 'all-minilm',
  coquiUp: true,
  whisperCliPresent: true,
  audioForkLoaded: true,
  aiLiveEnabled: true,
  enabledPersonaCount: 1,
  boundPersonaCount: 1,
};
const item = (r: ReturnType<typeof evaluateAiReadiness>, k: string) =>
  r.items.find((i) => i.key === k)!;

describe('modelPresent', () => {
  it('exact / base / tagged match', () => {
    expect(modelPresent(['qwen2.5:3b'], 'qwen2.5:3b')).toBe(true);
    expect(modelPresent(['all-minilm:latest'], 'all-minilm')).toBe(
      true,
    );
    expect(modelPresent(['qwen2.5:3b:latest'], 'qwen2.5:3b')).toBe(
      true,
    );
  });
  it('miss / bad inputs', () => {
    expect(modelPresent(['llama3'], 'qwen2.5:3b')).toBe(false);
    expect(modelPresent(null as unknown as string[], 'x')).toBe(
      false,
    );
    expect(modelPresent(['x'], '')).toBe(false);
  });
});

describe('evaluateAiReadiness — armed paths', () => {
  it('fully ready + live => armed + live', () => {
    const r = evaluateAiReadiness(READY);
    expect(r.armed).toBe(true);
    expect(r.live).toBe(true);
    expect(r.blockers).toBe(0);
    expect(r.summary).toContain('LIVE');
  });
  it('ready but switch off => armed, not live, inert summary', () => {
    const r = evaluateAiReadiness({
      ...READY,
      aiLiveEnabled: false,
    });
    expect(r.armed).toBe(true);
    expect(r.live).toBe(false);
    expect(item(r, 'master_switch').status).toBe('warn');
    expect(r.summary).toContain('inert by design');
  });
  it('embed model missing => warn, still armed', () => {
    const r = evaluateAiReadiness({
      ...READY,
      models: ['qwen2.5:3b'],
    });
    expect(item(r, 'embed_model').status).toBe('warn');
    expect(r.armed).toBe(true);
  });
});

describe('evaluateAiReadiness — blockers', () => {
  it('ollama down blocks ollama + llm_model', () => {
    const r = evaluateAiReadiness({
      ...READY,
      ollamaUp: false,
      models: [],
    });
    expect(item(r, 'ollama').status).toBe('blocked');
    expect(item(r, 'llm_model').status).toBe('blocked');
    expect(r.armed).toBe(false);
    expect(r.summary).toContain('blocker');
  });
  it('missing persona model => pull remediation', () => {
    const r = evaluateAiReadiness({
      ...READY,
      models: ['all-minilm'],
      llmModelsConfigured: ['qwen2.5:3b'],
    });
    const li = item(r, 'llm_model');
    expect(li.status).toBe('blocked');
    expect(li.remediation).toBe('ollama pull qwen2.5:3b');
    expect(r.armed).toBe(false);
  });
  it('no personas configured => llm_model warn, not blocker', () => {
    const r = evaluateAiReadiness({
      ...READY,
      llmModelsConfigured: [],
    });
    expect(item(r, 'llm_model').status).toBe('warn');
    expect(item(r, 'llm_model').required).toBe(false);
    expect(r.armed).toBe(true);
  });
  it('whisper missing => blocked + not armed', () => {
    const r = evaluateAiReadiness({
      ...READY,
      whisperCliPresent: false,
    });
    expect(item(r, 'whisper').status).toBe('blocked');
    expect(r.armed).toBe(false);
  });
  it('coqui down => blocked', () => {
    const r = evaluateAiReadiness({ ...READY, coquiUp: false });
    expect(item(r, 'coqui').status).toBe('blocked');
    expect(r.armed).toBe(false);
  });
  it('mod_audio_stream not loaded => blocked (the boundary)', () => {
    const r = evaluateAiReadiness({
      ...READY,
      audioForkLoaded: false,
    });
    const a = item(r, 'audio_fork');
    expect(a.status).toBe('blocked');
    expect(a.remediation).toContain('install-audio-fork.sh');
    expect(r.armed).toBe(false);
  });
});

describe('evaluateAiReadiness — persona binding', () => {
  it('enabled but none bound => warn', () => {
    const r = evaluateAiReadiness({
      ...READY,
      boundPersonaCount: 0,
      enabledPersonaCount: 2,
    });
    expect(item(r, 'persona_bound').status).toBe('warn');
    expect(item(r, 'persona_bound').detail).toContain('none bound');
    expect(r.armed).toBe(true); // not required
  });
  it('no enabled persona => warn w/ create remediation', () => {
    const r = evaluateAiReadiness({
      ...READY,
      boundPersonaCount: 0,
      enabledPersonaCount: 0,
    });
    expect(item(r, 'persona_bound').remediation).toContain(
      'Create + enable',
    );
  });
});

describe('counts', () => {
  it('blockers + warnings tallied', () => {
    const r = evaluateAiReadiness({
      ollamaUp: false,
      models: [],
      llmModelsConfigured: ['qwen2.5:3b'],
      embedModel: 'all-minilm',
      coquiUp: false,
      whisperCliPresent: false,
      audioForkLoaded: false,
      aiLiveEnabled: false,
      enabledPersonaCount: 0,
      boundPersonaCount: 0,
    });
    // ollama, llm_model, whisper, coqui, audio_fork = 5 blockers
    expect(r.blockers).toBe(5);
    expect(r.armed).toBe(false);
    // embed, persona_bound, master_switch = 3 warnings
    expect(r.warnings).toBe(3);
  });
});
