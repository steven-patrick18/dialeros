import { describe, expect, it } from 'vitest';
import {
  buildQaPrompt,
  parseQaResponse,
  QA_FLAG_VOCAB,
} from '../src/ai-qa';

const PERSONA = {
  name: 'Acme Setter',
  system_prompt: 'Book a roof inspection. Be polite. Never lie.',
};

describe('buildQaPrompt', () => {
  it('system asks for JSON-only + includes the flag vocab', () => {
    const m = buildQaPrompt(PERSONA, []);
    expect(m).toHaveLength(2);
    expect(m[0].role).toBe('system');
    expect(m[0].content).toMatch(/JSON object/i);
    for (const f of QA_FLAG_VOCAB) {
      expect(m[0].content).toContain(f);
    }
  });

  it('user carries the persona instructions + transcript', () => {
    const m = buildQaPrompt(PERSONA, [
      { role: 'ai', text: 'Hi, Acme scheduling.' },
      { role: 'caller', text: 'not interested' },
    ]);
    expect(m[1].content).toContain('Book a roof inspection');
    expect(m[1].content).toContain('AGENT: Hi, Acme scheduling.');
    expect(m[1].content).toContain('CALLER: not interested');
  });

  it('empty / whitespace turns are dropped; placeholder when none', () => {
    const m = buildQaPrompt(PERSONA, [
      { role: 'ai', text: '   ' },
      { role: 'caller', text: '' },
    ]);
    expect(m[1].content).toContain('(no turns recorded)');
  });
});

describe('parseQaResponse — clean cases', () => {
  it('parses a well-formed object', () => {
    const r = parseQaResponse(
      '{"score": 87, "summary": "Followed script, polite.", "flags": ["goal-met"]}',
    );
    expect(r).toEqual({
      score: 87,
      summary: 'Followed script, polite.',
      flags: ['goal-met'],
    });
  });

  it('strips ``` fences + trailing prose', () => {
    const raw =
      '```json\n{"score": 40, "summary": "Rushed.", "flags": ["off-script","rude-or-pushy"]}\n```\nHope that helps!';
    const r = parseQaResponse(raw);
    expect(r.score).toBe(40);
    expect(r.flags).toEqual(['off-script', 'rude-or-pushy']);
  });

  it('grabs the first balanced object when prose precedes it', () => {
    const r = parseQaResponse(
      'Sure, here is my review: {"score": 55, "summary": "ok", "flags": []} done.',
    );
    expect(r.score).toBe(55);
    expect(r.summary).toBe('ok');
    expect(r.flags).toEqual([]);
  });
});

describe('parseQaResponse — coercion + clamping', () => {
  it('clamps score to 0-100 and rounds', () => {
    expect(parseQaResponse('{"score": 250}').score).toBe(100);
    expect(parseQaResponse('{"score": -8}').score).toBe(0);
    expect(parseQaResponse('{"score": 72.6}').score).toBe(73);
  });

  it('non-numeric / missing score → 0', () => {
    expect(parseQaResponse('{"score": "great"}').score).toBe(0);
    expect(parseQaResponse('{"summary":"x"}').score).toBe(0);
  });

  it('normalizes flags (lowercase, kebab, dedupe-able, capped)', () => {
    const r = parseQaResponse(
      '{"score":1,"flags":["Goal Met","COMPLIANCE_RISK","  weird!! tag  "]}',
    );
    expect(r.flags).toEqual([
      'goal-met',
      'compliance-risk',
      'weird-tag',
    ]);
  });

  it('drops non-string flags + over-long flags + caps at 12', () => {
    const many = Array.from({ length: 30 }, (_, i) => `f${i}`);
    const r = parseQaResponse(
      JSON.stringify({ score: 1, flags: [...many, 123, 'x'.repeat(60)] }),
    );
    expect(r.flags).toHaveLength(12);
    expect(r.flags.every((f) => typeof f === 'string')).toBe(true);
  });

  it('missing summary → placeholder', () => {
    expect(parseQaResponse('{"score":50}').summary).toBe('(no summary)');
  });
});

describe('parseQaResponse — failure modes', () => {
  it('empty / non-string → parse-failed', () => {
    for (const v of ['', '   ', null as unknown as string]) {
      const r = parseQaResponse(v);
      expect(r.score).toBe(0);
      expect(r.flags).toEqual(['parse-failed']);
    }
  });

  it('no JSON at all → parse-failed', () => {
    expect(parseQaResponse('I cannot grade this.').flags).toEqual([
      'parse-failed',
    ]);
  });

  it('unbalanced braces → parse-failed', () => {
    expect(
      parseQaResponse('{"score": 50, "summary": "oops"').flags,
    ).toEqual(['parse-failed']);
  });

  it('malformed JSON inside braces → parse-failed', () => {
    expect(parseQaResponse('{score: 50,}').flags).toEqual([
      'parse-failed',
    ]);
  });
});
