import { describe, expect, it } from 'vitest';
import {
  pickAbPersona,
  summarizeAbResults,
  type AbSessionRow,
} from '../src/ai-ab';

describe('pickAbPersona — degenerate → A (never break dialing)', () => {
  it('no B id → A', () => {
    expect(pickAbPersona('A', null, 50, 0.0)).toBe('A');
    expect(pickAbPersona('A', undefined, 50, 0.0)).toBe('A');
    expect(pickAbPersona('A', '', 50, 0.0)).toBe('A');
  });
  it('abPct <= 0 or non-finite → A', () => {
    expect(pickAbPersona('A', 'B', 0, 0.0)).toBe('A');
    expect(pickAbPersona('A', 'B', -10, 0.0)).toBe('A');
    expect(pickAbPersona('A', 'B', NaN, 0.0)).toBe('A');
  });
  it('abPct >= 100 → B', () => {
    expect(pickAbPersona('A', 'B', 100, 0.99)).toBe('B');
    expect(pickAbPersona('A', 'B', 150, 0.0)).toBe('B');
  });
});

describe('pickAbPersona — weighted split', () => {
  it('rng below threshold → B, at/above → A (50%)', () => {
    expect(pickAbPersona('A', 'B', 50, 0.49)).toBe('B');
    expect(pickAbPersona('A', 'B', 50, 0.5)).toBe('A');
    expect(pickAbPersona('A', 'B', 50, 0.0)).toBe('B');
    expect(pickAbPersona('A', 'B', 50, 0.999)).toBe('A');
  });
  it('25% split boundary', () => {
    expect(pickAbPersona('A', 'B', 25, 0.24)).toBe('B');
    expect(pickAbPersona('A', 'B', 25, 0.25)).toBe('A');
  });
  it('out-of-range rng clamps to 0 (→ B side when split>0)', () => {
    expect(pickAbPersona('A', 'B', 50, 1.5)).toBe('B');
    expect(pickAbPersona('A', 'B', 50, -1)).toBe('B');
  });
  it('roughly distributes over many draws', () => {
    let b = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      if (pickAbPersona('A', 'B', 30, i / N) === 'B') b++;
    }
    const pct = (b / N) * 100;
    expect(pct).toBeGreaterThan(27);
    expect(pct).toBeLessThan(33);
  });
});

describe('summarizeAbResults', () => {
  const rows: AbSessionRow[] = [
    { persona_id: 'A', status: 'completed', turn_count: 6, qa_score: 80 },
    { persona_id: 'A', status: 'escalated', turn_count: 3, qa_score: 40 },
    { persona_id: 'A', status: 'completed', turn_count: 9, qa_score: null },
    { persona_id: 'B', status: 'completed', turn_count: 4, qa_score: 90 },
    { persona_id: 'B', status: 'seized', turn_count: 2, qa_score: null },
  ];

  it('groups + computes per-variant stats', () => {
    const s = summarizeAbResults(rows);
    const a = s.find((v) => v.persona_id === 'A')!;
    const b = s.find((v) => v.persona_id === 'B')!;
    expect(a.count).toBe(3);
    expect(a.completed).toBe(2);
    expect(a.escalated).toBe(1);
    expect(a.completed_pct).toBe(66.7);
    expect(a.avg_turns).toBe(6); // (6+3+9)/3
    expect(a.avg_qa).toBe(60); // (80+40)/2 graded only
    expect(a.graded).toBe(2);
    expect(b.count).toBe(2);
    expect(b.seized).toBe(1);
    expect(b.avg_qa).toBe(90);
  });

  it('sorts by count desc', () => {
    expect(summarizeAbResults(rows)[0].persona_id).toBe('A');
  });

  it('avg_qa null when no graded sessions', () => {
    const s = summarizeAbResults([
      { persona_id: 'X', status: 'completed', turn_count: 1, qa_score: null },
    ]);
    expect(s[0].avg_qa).toBeNull();
    expect(s[0].graded).toBe(0);
  });

  it('skips rows with no persona_id; handles empty', () => {
    expect(summarizeAbResults([])).toEqual([]);
    const s = summarizeAbResults([
      { persona_id: '', status: 'completed', turn_count: 1, qa_score: 1 },
    ]);
    expect(s).toEqual([]);
  });

  it('tolerates non-finite turn_count', () => {
    const s = summarizeAbResults([
      {
        persona_id: 'Z',
        status: 'completed',
        turn_count: NaN,
        qa_score: null,
      },
    ]);
    expect(s[0].avg_turns).toBe(0);
  });
});
