import { describe, expect, it } from 'vitest';
import {
  buildRetrievalBlock,
  buildExemplarFromTurns,
  shouldPromoteExemplar,
  EXEMPLAR_MIN_SCORE,
} from '../src/ai-rag';

describe('buildRetrievalBlock', () => {
  it('no hits / non-array -> empty string', () => {
    expect(buildRetrievalBlock([])).toBe('');
    expect(buildRetrievalBlock(null as unknown as [])).toBe('');
  });
  it('single hit renders header + bullet', () => {
    const b = buildRetrievalBlock([
      { title: 'Refund window', content: '30 days.', score: 0.9 },
    ]);
    expect(b).toContain('RELEVANT KNOWLEDGE');
    expect(b).toContain('- Refund window: 30 days.');
  });
  it('hit with no title omits the "title:" prefix', () => {
    const b = buildRetrievalBlock([
      { title: '', content: 'Always greet by name.', score: 0.7 },
    ]);
    expect(b).toContain('- Always greet by name.');
    expect(b).not.toContain(': Always greet');
  });
  it('blank-content hits skipped; all-blank -> empty', () => {
    expect(
      buildRetrievalBlock([{ title: 't', content: '   ', score: 1 }]),
    ).toBe('');
  });
  it('char cap drops WHOLE later hits (no mid-fact cut)', () => {
    const big = 'x'.repeat(400);
    const b = buildRetrievalBlock(
      [
        { title: 'A', content: big, score: 0.9 },
        { title: 'B', content: big, score: 0.8 },
        { title: 'C', content: big, score: 0.7 },
      ],
      600,
    );
    expect(b).toContain(big);
    expect(b.length).toBeLessThanOrEqual(600);
    expect(
      b.split('\n').filter((l) => l.startsWith('- ')).length,
    ).toBe(1);
  });
  it('keeps caller-supplied hit order', () => {
    const b = buildRetrievalBlock([
      { title: 'first', content: 'one', score: 0.9 },
      { title: 'second', content: 'two', score: 0.8 },
    ]);
    expect(b.indexOf('first')).toBeLessThan(b.indexOf('second'));
  });
});

describe('buildExemplarFromTurns', () => {
  const good = [
    { role: 'ai', text: 'Thanks for calling Acme, this is Sarah.' },
    { role: 'caller', text: 'I need to reset my password.' },
    { role: 'ai', text: 'Happy to help — link sent.' },
  ];
  it('renders Caller/Agent labelled transcript', () => {
    const t = buildExemplarFromTurns(good);
    expect(t).toContain('Agent: Thanks for calling Acme');
    expect(t).toContain('Caller: I need to reset my password.');
  });
  it('requires >=1 caller AND >=1 ai turn', () => {
    expect(buildExemplarFromTurns([{ role: 'ai', text: 'hi' }])).toBe(
      '',
    );
    expect(
      buildExemplarFromTurns([{ role: 'caller', text: 'hi' }]),
    ).toBe('');
  });
  it('non-array / empty -> empty string', () => {
    expect(buildExemplarFromTurns([])).toBe('');
    expect(buildExemplarFromTurns(null as unknown as [])).toBe('');
  });
  it('skips blank / unknown-role turns', () => {
    const t = buildExemplarFromTurns([
      { role: 'system', text: 'ignored' },
      { role: 'ai', text: '   ' },
      { role: 'ai', text: 'Hello.' },
      { role: 'caller', text: 'Hi.' },
    ]);
    expect(t).not.toContain('ignored');
    expect(t).toBe('Agent: Hello.\nCaller: Hi.');
  });
  it('drops OLDEST turns when over budget (keeps the close)', () => {
    const turns = [
      { role: 'ai', text: 'A'.repeat(40) },
      { role: 'caller', text: 'B'.repeat(40) },
      { role: 'ai', text: 'KEEP THE END' },
    ];
    const t = buildExemplarFromTurns(turns, 40);
    expect(t).toContain('KEEP THE END');
    expect(t).not.toContain('A'.repeat(40));
    expect(t.length).toBeLessThanOrEqual(40);
  });
  it('single over-budget turn is hard-cut, not dropped', () => {
    const t = buildExemplarFromTurns(
      [
        { role: 'caller', text: 'hi' },
        { role: 'ai', text: 'z'.repeat(100) },
      ],
      20,
    );
    expect(t.length).toBe(20);
  });
});

describe('shouldPromoteExemplar / EXEMPLAR_MIN_SCORE', () => {
  it('min score is a high bar on the 0-100 QA scale', () => {
    expect(EXEMPLAR_MIN_SCORE).toBeGreaterThanOrEqual(80);
    expect(EXEMPLAR_MIN_SCORE).toBeLessThanOrEqual(100);
  });
  it('at / above threshold + not promoted -> true', () => {
    expect(shouldPromoteExemplar(EXEMPLAR_MIN_SCORE, false)).toBe(
      true,
    );
    expect(shouldPromoteExemplar(100, false)).toBe(true);
  });
  it('below threshold -> false', () => {
    expect(
      shouldPromoteExemplar(EXEMPLAR_MIN_SCORE - 1, false),
    ).toBe(false);
    expect(shouldPromoteExemplar(0, false)).toBe(false);
  });
  it('already promoted -> false even at a perfect score', () => {
    expect(shouldPromoteExemplar(100, true)).toBe(false);
  });
  it('null / undefined / NaN score -> false', () => {
    expect(shouldPromoteExemplar(null, false)).toBe(false);
    expect(shouldPromoteExemplar(undefined, false)).toBe(false);
    expect(shouldPromoteExemplar(NaN, false)).toBe(false);
  });
  it('custom minScore respected', () => {
    expect(shouldPromoteExemplar(50, false, 40)).toBe(true);
    expect(shouldPromoteExemplar(50, false, 60)).toBe(false);
  });
});
