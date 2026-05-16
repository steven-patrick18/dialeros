import { describe, expect, it } from 'vitest';
import {
  chunkText,
  cosineSim,
  rankBySimilarity,
} from '../src/ai-memory';

describe('cosineSim', () => {
  it('identical vectors → 1', () => {
    expect(cosineSim([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });
  it('orthogonal → 0', () => {
    expect(cosineSim([1, 0], [0, 1])).toBe(0);
  });
  it('opposite → -1', () => {
    expect(cosineSim([1, 1], [-1, -1])).toBeCloseTo(-1, 10);
  });
  it('scale-invariant', () => {
    expect(cosineSim([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 10);
  });
  it('zero vector → 0 (no NaN)', () => {
    expect(cosineSim([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(Number.isNaN(cosineSim([0, 0], [0, 0]))).toBe(false);
  });
  it('mismatched length / empty / non-array → 0', () => {
    expect(cosineSim([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSim([], [])).toBe(0);
    expect(cosineSim(null as unknown as number[], [1])).toBe(0);
  });
});

describe('rankBySimilarity', () => {
  const cands = [
    { item: 'a', vector: [1, 0, 0] },
    { item: 'b', vector: [0.9, 0.1, 0] },
    { item: 'c', vector: [0, 1, 0] },
    { item: 'd', vector: [0, 0, 1] },
  ];
  it('returns top-K by descending cosine', () => {
    const r = rankBySimilarity([1, 0, 0], cands, 2);
    expect(r.map((x) => x.item)).toEqual(['a', 'b']);
    expect(r[0].score).toBeCloseTo(1, 10);
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });
  it('minScore filters weak matches', () => {
    const r = rankBySimilarity([1, 0, 0], cands, 10, 0.5);
    expect(r.map((x) => x.item)).toEqual(['a', 'b']); // c,d ~0
  });
  it('k<=0 → empty', () => {
    expect(rankBySimilarity([1, 0, 0], cands, 0)).toEqual([]);
  });
  it('stable on tied scores (input order kept)', () => {
    const tied = [
      { item: 'x', vector: [1, 0] },
      { item: 'y', vector: [1, 0] },
    ];
    expect(
      rankBySimilarity([1, 0], tied, 2).map((h) => h.item),
    ).toEqual(['x', 'y']);
  });
  it('empty candidates → empty', () => {
    expect(rankBySimilarity([1], [], 5)).toEqual([]);
  });
});

describe('chunkText', () => {
  it('short text → single chunk', () => {
    expect(chunkText('Hello world.', 800)).toEqual(['Hello world.']);
  });
  it('empty / whitespace / non-string → []', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
    expect(chunkText(null as unknown as string)).toEqual([]);
  });
  it('splits on paragraph breaks', () => {
    const c = chunkText('Para one.\n\nPara two.\n\nPara three.', 800);
    expect(c).toEqual(['Para one.', 'Para two.', 'Para three.']);
  });
  it('splits a long paragraph on sentence boundaries within max', () => {
    const p =
      'Sentence one is here. Sentence two is here. Sentence three is here.';
    const c = chunkText(p, 30);
    expect(c.length).toBeGreaterThan(1);
    expect(c.every((x) => x.length <= 30)).toBe(true);
    expect(c.join(' ')).toContain('Sentence one');
  });
  it('hard-cuts a single sentence longer than max', () => {
    const c = chunkText('x'.repeat(50), 20);
    expect(c).toEqual(['x'.repeat(20), 'x'.repeat(20), 'x'.repeat(10)]);
  });
  it('never emits an empty chunk', () => {
    const c = chunkText('a.\n\n\n\nb.', 800);
    expect(c.every((x) => x.trim().length > 0)).toBe(true);
    expect(c).toEqual(['a.', 'b.']);
  });
});
