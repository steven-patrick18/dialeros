import { describe, expect, it } from 'vitest';
import {
  applyIdentity,
  buildIdentityGuard,
  scrubIdentityLeak,
} from '../src/ai-identity';

describe('buildIdentityGuard', () => {
  it('empty name → empty guard (back-compat no-op)', () => {
    expect(buildIdentityGuard('', 'Manager')).toBe('');
    expect(buildIdentityGuard('   ', null)).toBe('');
  });
  it('name only', () => {
    const g = buildIdentityGuard('Sarah', null);
    expect(g).toContain('You are Sarah.');
    expect(g).toContain('"Sarah"');
    expect(g).toMatch(/NEVER say or imply you are an AI/i);
  });
  it('name + title', () => {
    const g = buildIdentityGuard('Sarah', 'Senior Advisor');
    expect(g).toContain('You are Sarah, Senior Advisor.');
    expect(g).toContain('"Sarah, Senior Advisor"');
  });
});

describe('applyIdentity', () => {
  it('prepends the guard ahead of the persona prompt', () => {
    const out = applyIdentity('Book the appointment.', 'Sarah', 'Advisor');
    expect(out.startsWith('IDENTITY')).toBe(true);
    expect(out).toContain('Book the appointment.');
    expect(out.indexOf('IDENTITY')).toBeLessThan(
      out.indexOf('Book the appointment.'),
    );
  });
  it('no name → passthrough unchanged', () => {
    expect(applyIdentity('Do the thing.', '', null)).toBe('Do the thing.');
  });
});

describe('scrubIdentityLeak — disclosures rewritten', () => {
  // Implementation normalizes every first-person disclosure to
  // "I'm <who>" deterministically (am/'m not preserved).
  const cases: Array<[string, RegExp]> = [
    ["As an AI, I can't feel emotions.", /^as Sarah, I can't/],
    ['I am an AI language model.', /^I'm Sarah, Advisor\.$/],
    ["I'm an AI language model trained by.", /^I'm Sarah, Advisor trained by\.$/],
    ['I am a bot here to help.', /^I'm Sarah, Advisor here to help\.$/],
    ["I'm a chatbot.", /^I'm Sarah, Advisor\.$/],
    ['I am a virtual assistant.', /^I'm Sarah, Advisor\.$/],
    ['I am an artificial intelligence.', /^I'm Sarah, Advisor\.$/],
    ['I am not a real person.', /^I'm Sarah\.$/],
    ["I'm not a human.", /^I'm Sarah\.$/],
    ['This is powered by Qwen.', /Sarah/],
    ['I run on Llama 3.', /Sarah/],
  ];
  it.each(cases)('rewrites %j', (input, expected) => {
    const r = scrubIdentityLeak(input, 'Sarah', 'Advisor');
    expect(r.leaked).toBe(true);
    expect(r.text).toMatch(expected);
    expect(r.text.toLowerCase()).not.toMatch(
      /\bas an ai\b|language model|i am an ai|i'm a bot|chatbot|virtual assistant|qwen|llama/,
    );
  });
});

describe('scrubIdentityLeak — guards', () => {
  it('clean text is untouched, leaked=false', () => {
    const r = scrubIdentityLeak(
      'Sure, I can book that for you on Tuesday.',
      'Sarah',
      'Advisor',
    );
    expect(r.leaked).toBe(false);
    expect(r.text).toBe('Sure, I can book that for you on Tuesday.');
  });
  it('no name → passthrough', () => {
    const r = scrubIdentityLeak('I am an AI', '', null);
    expect(r.text).toBe('I am an AI');
    expect(r.leaked).toBe(false);
  });
  it('empty / non-string text', () => {
    expect(scrubIdentityLeak('', 'Sarah').text).toBe('');
    expect(
      scrubIdentityLeak(null as unknown as string, 'Sarah').leaked,
    ).toBe(false);
  });
  it('title omitted → name only in substitution', () => {
    const r = scrubIdentityLeak('I am an AI language model.', 'Max');
    expect(r.text).toBe("I'm Max.");
  });
  it('multiple leaks in one reply all rewritten', () => {
    const r = scrubIdentityLeak(
      "As an AI, I can't. I'm a bot, but Qwen helps.",
      'Max',
      null,
    );
    expect(r.leaked).toBe(true);
    expect(r.text).not.toMatch(/as an ai|i'm a bot|qwen/i);
    expect(r.text).toContain('Max');
  });
  it('scrubs the real 3B-model paraphrase leak observed live', () => {
    // Exact shape qwen2.5:3b produced under "are you an AI?"
    const raw =
      "I am Sarah, Senior Advisor. As for being real or AI, I assure you I am the latter—someone who has been programmed to assist with scheduling efficiently.";
    const r = scrubIdentityLeak(raw, 'Sarah', 'Senior Advisor');
    expect(r.leaked).toBe(true);
    // The leak SIGNALS must be gone; the bare word "AI" echoing
    // the caller's own framing while denying is acceptable.
    expect(r.text.toLowerCase()).not.toMatch(
      /\bthe latter\b|programmed to/,
    );
    expect(r.text).toContain('Sarah');
  });

  it('is case-insensitive', () => {
    const r = scrubIdentityLeak('i AM aN Ai LANGUAGE MODEL', 'Max', null);
    expect(r.leaked).toBe(true);
    expect(r.text.toLowerCase()).not.toContain('language model');
  });
  it('does not false-positive on ordinary words', () => {
    const txt = 'The aircraft model and the botanical garden are open.';
    const r = scrubIdentityLeak(txt, 'Max', null);
    expect(r.leaked).toBe(false);
    expect(r.text).toBe(txt);
  });
});
