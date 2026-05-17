import { describe, expect, it } from 'vitest';
import {
  parsePerfConfig,
  resolveOllamaOptions,
  resolveTtsSpeed,
  budgetMessages,
  REPLY_LEN_TOKENS,
  DEFAULT_TEMPERATURE,
  KEEP_WARM_TTL,
} from '../src/ai-perf';

describe('parsePerfConfig', () => {
  it('null / bad JSON / non-object -> {}', () => {
    expect(parsePerfConfig(null)).toEqual({});
    expect(parsePerfConfig('{nope')).toEqual({});
    expect(parsePerfConfig('42')).toEqual({});
    expect(parsePerfConfig('[1,2]')).toEqual({});
  });
  it('good JSON round-trips', () => {
    expect(parsePerfConfig('{"keep_warm":true}')).toEqual({
      keep_warm: true,
    });
  });
});

describe('resolveOllamaOptions — inert by default', () => {
  it('empty config == pre-207 body exactly', () => {
    const r = resolveOllamaOptions({});
    expect(r.options).toEqual({ temperature: DEFAULT_TEMPERATURE });
    expect(r.keepAlive).toBeUndefined();
  });
  it('null config is safe', () => {
    expect(resolveOllamaOptions(null).options).toEqual({
      temperature: DEFAULT_TEMPERATURE,
    });
  });
  it('uncapped reply_length adds no num_predict', () => {
    expect(
      resolveOllamaOptions({ reply_length: 'uncapped' }).options
        .num_predict,
    ).toBeUndefined();
  });
});

describe('resolveOllamaOptions — knobs', () => {
  it('reply_length presets map to token caps', () => {
    expect(
      resolveOllamaOptions({ reply_length: 'short' }).options
        .num_predict,
    ).toBe(REPLY_LEN_TOKENS.short);
    expect(
      resolveOllamaOptions({ reply_length: 'long' }).options
        .num_predict,
    ).toBe(REPLY_LEN_TOKENS.long);
  });
  it('temperature clamped to [0,1.5]', () => {
    expect(
      resolveOllamaOptions({ temperature: 9 }).options.temperature,
    ).toBe(1.5);
    expect(
      resolveOllamaOptions({ temperature: -1 }).options.temperature,
    ).toBe(0);
    expect(
      resolveOllamaOptions({ temperature: 0.3 }).options.temperature,
    ).toBe(0.3);
  });
  it('NaN temperature falls back to default', () => {
    expect(
      resolveOllamaOptions({ temperature: NaN }).options.temperature,
    ).toBe(DEFAULT_TEMPERATURE);
  });
  it('num_ctx only honored in-range + integer', () => {
    expect(
      resolveOllamaOptions({ num_ctx: 2048 }).options.num_ctx,
    ).toBe(2048);
    expect(
      resolveOllamaOptions({ num_ctx: 10 }).options.num_ctx,
    ).toBeUndefined();
    expect(
      resolveOllamaOptions({ num_ctx: 4096.5 }).options.num_ctx,
    ).toBeUndefined();
  });
  it('keep_warm -> KEEP_WARM_TTL', () => {
    expect(resolveOllamaOptions({ keep_warm: true }).keepAlive).toBe(
      KEEP_WARM_TTL,
    );
    expect(
      resolveOllamaOptions({ keep_warm: false }).keepAlive,
    ).toBeUndefined();
  });
});

describe('resolveTtsSpeed', () => {
  it('default 1.0 when unset / non-number / NaN', () => {
    expect(resolveTtsSpeed({})).toBe(1.0);
    expect(resolveTtsSpeed(null)).toBe(1.0);
    expect(resolveTtsSpeed({ tts_speed: NaN })).toBe(1.0);
  });
  it('clamped to [0.7,1.4]', () => {
    expect(resolveTtsSpeed({ tts_speed: 5 })).toBe(1.4);
    expect(resolveTtsSpeed({ tts_speed: 0.1 })).toBe(0.7);
    expect(resolveTtsSpeed({ tts_speed: 1.1 })).toBe(1.1);
  });
});

describe('budgetMessages', () => {
  const M = [
    { role: 'system', content: 'S'.repeat(10) }, // pinned
    { role: 'system', content: 'K'.repeat(10) }, // pinned (RAG)
    { role: 'assistant', content: 'G'.repeat(10) }, // pinned greet
    { role: 'user', content: 'u1'.repeat(10) }, // history (oldest)
    { role: 'assistant', content: 'a1'.repeat(10) }, // history
    { role: 'user', content: 'u2'.repeat(10) }, // history
    { role: 'user', content: 'LAST'.repeat(10) }, // pinned (last)
  ];
  it('maxChars<=0 / non-int -> unchanged (inert)', () => {
    expect(budgetMessages(M, 0)).toBe(M);
    expect(budgetMessages(M, -5)).toBe(M);
    expect(budgetMessages(M, 1.5)).toBe(M);
  });
  it('within budget -> unchanged', () => {
    expect(budgetMessages(M, 100000)).toBe(M);
  });
  it('drops OLDEST history first, preserves order', () => {
    // tight enough to force dropping u1 (and maybe a1)
    const out = budgetMessages(M, 70);
    const roles = out.map((m) => m.content);
    // pinned always present
    expect(roles).toContain('S'.repeat(10));
    expect(roles).toContain('K'.repeat(10));
    expect(roles).toContain('G'.repeat(10));
    expect(roles).toContain('LAST'.repeat(10));
    // oldest history dropped first
    expect(roles).not.toContain('u1'.repeat(10));
    // still in original relative order
    expect(out.map((m) => M.indexOf(m))).toEqual(
      [...out.map((m) => M.indexOf(m))].sort((a, b) => a - b),
    );
  });
  it('over-tight budget -> pinned-only, last kept', () => {
    const out = budgetMessages(M, 1);
    expect(out.map((m) => m.role)).toEqual([
      'system',
      'system',
      'assistant',
      'user',
    ]);
    expect(out[out.length - 1]?.content).toBe('LAST'.repeat(10));
  });
  it('empty array -> unchanged', () => {
    expect(budgetMessages([], 100)).toEqual([]);
  });
});
