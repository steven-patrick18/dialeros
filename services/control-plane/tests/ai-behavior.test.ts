import { describe, expect, it } from 'vitest';
import { applyBehavior, buildBehaviorGuard } from '../src/ai-behavior';
import { applyIdentity } from '../src/ai-identity';

describe('buildBehaviorGuard', () => {
  const g = buildBehaviorGuard();
  it('declares the strict, always-applies header', () => {
    expect(g).toMatch(/^BEHAVIOR \(strict, always applies\):/);
  });
  it('mandates natural US English + contractions', () => {
    expect(g).toMatch(/US English/);
    expect(g).toMatch(/[Cc]ontractions/);
  });
  it('mandates concise professional executive register', () => {
    expect(g).toMatch(/concise/i);
    expect(g).toMatch(/professional/i);
    expect(g).toMatch(/executive/i);
  });
  it('bans markdown/emoji (spoken audio) + digit-string read-outs', () => {
    expect(g).toMatch(/No markdown/i);
    expect(g).toMatch(/emoji/i);
    expect(g).toMatch(/SPOKEN audio/);
    expect(g).toMatch(/numbers, dates, times/);
  });
  it('forbids arguing + clichés', () => {
    expect(g).toMatch(/never argue/i);
    expect(g).toMatch(/clich/i);
  });
});

describe('applyBehavior', () => {
  it('prepends the guard ahead of the prompt', () => {
    const out = applyBehavior('Book the meeting.');
    expect(out.startsWith('BEHAVIOR (strict')).toBe(true);
    expect(out).toContain('Book the meeting.');
    expect(out.indexOf('BEHAVIOR')).toBeLessThan(
      out.indexOf('Book the meeting.'),
    );
  });
});

describe('identity + behavior composition order', () => {
  it('IDENTITY first, then BEHAVIOR, then persona script', () => {
    const composed = applyIdentity(
      applyBehavior('PERSONA: sell roofing.'),
      'Sarah',
      'Senior Advisor',
    );
    const iIdent = composed.indexOf('IDENTITY');
    const iBeh = composed.indexOf('BEHAVIOR (strict');
    const iPersona = composed.indexOf('PERSONA: sell roofing.');
    expect(iIdent).toBeGreaterThanOrEqual(0);
    expect(iIdent).toBeLessThan(iBeh);
    expect(iBeh).toBeLessThan(iPersona);
    // identity still asserts the configured name
    expect(composed).toContain('You are Sarah, Senior Advisor.');
  });
  it('no identity (legacy persona) → behavior still applies', () => {
    const composed = applyIdentity(
      applyBehavior('do the thing'),
      '',
      null,
    );
    expect(composed.startsWith('BEHAVIOR (strict')).toBe(true);
    expect(composed).toContain('do the thing');
  });
});
