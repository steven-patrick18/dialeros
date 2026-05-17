import { describe, expect, it } from 'vitest';
import {
  defaultLlmProvider,
  parseLlmProvider,
  resolveLlmModel,
  isLocalLlmUrl,
  validateLlmProvider,
  buildChatRequest,
  parseChatReply,
  buildModelsRequest,
  parseModelsResponse,
  DEFAULT_OLLAMA_URL,
  type LlmProvider,
} from '../src/ai-llm';

const OLLAMA: LlmProvider = defaultLlmProvider();
const OAI: LlmProvider = {
  kind: 'openai_compat',
  base_url: 'http://127.0.0.1:8000',
  api_key: 'local-dummy',
};

describe('parseLlmProvider', () => {
  it('null / junk / non-object -> default ollama', () => {
    expect(parseLlmProvider(null)).toEqual(OLLAMA);
    expect(parseLlmProvider('{bad')).toEqual(OLLAMA);
    expect(parseLlmProvider('5')).toEqual(OLLAMA);
  });
  it('round-trips + strips trailing slash', () => {
    expect(
      parseLlmProvider(
        JSON.stringify({
          kind: 'openai_compat',
          base_url: 'http://127.0.0.1:8000/',
        }),
      ),
    ).toEqual({
      kind: 'openai_compat',
      base_url: 'http://127.0.0.1:8000',
    });
  });
  it('unknown kind -> ollama', () => {
    expect(
      parseLlmProvider(JSON.stringify({ kind: 'cloud' })).kind,
    ).toBe('ollama');
  });
});

describe('resolveLlmModel', () => {
  it('override wins; else persona model', () => {
    expect(
      resolveLlmModel(
        { ...OLLAMA, model_override: 'big-model' },
        'qwen2.5:3b',
      ),
    ).toBe('big-model');
    expect(resolveLlmModel(OLLAMA, 'qwen2.5:3b')).toBe('qwen2.5:3b');
  });
});

describe('isLocalLlmUrl', () => {
  it('local accepted', () => {
    for (const u of [
      'http://127.0.0.1:11434',
      'http://localhost:8000',
      'http://[::1]:1234',
      'http://10.0.0.5:11434',
      'http://192.168.1.9:8000',
      'http://172.16.0.2:8000',
      'http://169.254.1.1',
      'http://ollama:11434',
      'http://gpu-box.local',
      'https://infer.internal',
    ]) {
      expect(isLocalLlmUrl(u)).toBe(true);
    }
  });
  it('external / malformed rejected', () => {
    for (const u of [
      'https://api.openai.com/v1',
      'http://8.8.8.8',
      'http://example.com',
      'ftp://127.0.0.1',
      'not a url',
      '',
    ]) {
      expect(isLocalLlmUrl(u)).toBe(false);
    }
  });
});

describe('validateLlmProvider', () => {
  it('rejects non-object / missing / external base_url', () => {
    expect(validateLlmProvider(null).ok).toBe(false);
    expect(validateLlmProvider({ kind: 'ollama' }).ok).toBe(false);
    const ext = validateLlmProvider({
      kind: 'openai_compat',
      base_url: 'https://api.openai.com',
    });
    expect(ext.ok).toBe(false);
    if (!ext.ok) expect(ext.error).toContain('LOCAL');
  });
  it('accepts a local provider + trims', () => {
    const v = validateLlmProvider({
      kind: 'openai_compat',
      base_url: 'http://127.0.0.1:8000/',
      model_override: ' big ',
      api_key: 'k',
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.provider.base_url).toBe('http://127.0.0.1:8000');
      expect(v.provider.model_override).toBe('big');
      expect(v.provider.api_key).toBe('k');
    }
  });
});

describe('buildChatRequest', () => {
  it('ollama default == pre-209 body exactly', () => {
    const r = buildChatRequest(
      OLLAMA,
      'qwen2.5:3b',
      [{ role: 'user', content: 'hi' }],
      { temperature: 0.6 },
      '30m',
    );
    expect(r.url).toBe(`${DEFAULT_OLLAMA_URL}/api/chat`);
    expect(r.headers).toEqual({});
    expect(r.body).toEqual({
      model: 'qwen2.5:3b',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
      options: { temperature: 0.6 },
      keep_alive: '30m',
    });
  });
  it('ollama without keepAlive omits keep_alive', () => {
    const r = buildChatRequest(OLLAMA, 'm', [], {
      temperature: 0.1,
    });
    expect('keep_alive' in r.body).toBe(false);
  });
  it('openai_compat maps options + bearer', () => {
    const r = buildChatRequest(
      OAI,
      'm',
      [{ role: 'user', content: 'x' }],
      { temperature: 0.6, num_predict: 192 },
    );
    expect(r.url).toBe('http://127.0.0.1:8000/v1/chat/completions');
    expect(r.headers.Authorization).toBe('Bearer local-dummy');
    expect(r.body).toEqual({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      stream: false,
      temperature: 0.6,
      max_tokens: 192,
    });
  });
});

describe('parseChatReply', () => {
  it('ollama shape', () => {
    expect(
      parseChatReply(OLLAMA, { message: { content: '  hi ' } }),
    ).toBe('hi');
  });
  it('openai shape', () => {
    expect(
      parseChatReply(OAI, {
        choices: [{ message: { content: ' yo ' } }],
      }),
    ).toBe('yo');
  });
  it('junk / missing -> empty (never throws)', () => {
    expect(parseChatReply(OLLAMA, null)).toBe('');
    expect(parseChatReply(OAI, { choices: [] })).toBe('');
    expect(parseChatReply(OLLAMA, { message: {} })).toBe('');
  });
});

describe('models req/parse', () => {
  it('ollama tags', () => {
    expect(buildModelsRequest(OLLAMA).url).toBe(
      `${DEFAULT_OLLAMA_URL}/api/tags`,
    );
    expect(
      parseModelsResponse(OLLAMA, {
        models: [{ name: 'qwen2.5:3b' }, { name: 'all-minilm' }],
      }),
    ).toEqual(['qwen2.5:3b', 'all-minilm']);
  });
  it('openai models + bearer', () => {
    const r = buildModelsRequest(OAI);
    expect(r.url).toBe('http://127.0.0.1:8000/v1/models');
    expect(r.headers.Authorization).toBe('Bearer local-dummy');
    expect(
      parseModelsResponse(OAI, { data: [{ id: 'big' }, {}] }),
    ).toEqual(['big']);
  });
  it('bad payloads -> []', () => {
    expect(parseModelsResponse(OLLAMA, {})).toEqual([]);
    expect(parseModelsResponse(OAI, null)).toEqual([]);
  });
});
