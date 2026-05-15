import { describe, expect, it } from 'vitest';
import {
  evaluateSessionGuard,
  matchesEscalationKeyword,
  normalizeForMatch,
  type SessionGuardLimits,
} from '../src/ai-session-guard';

const LIMITS: SessionGuardLimits = {
  max_turns: 20,
  max_call_seconds: 300,
  escalation_keywords: ['human', 'lawyer', 'speak to a person', 'stop calling'],
};

describe('normalizeForMatch', () => {
  it('lowercases + strips punctuation + collapses whitespace', () => {
    expect(normalizeForMatch('  I WANT a   Lawyer!! ')).toBe(
      'i want a lawyer',
    );
    expect(normalizeForMatch("Don't—stop. calling")).toBe(
      'don t stop calling',
    );
  });
  it('handles empty / whitespace', () => {
    expect(normalizeForMatch('')).toBe('');
    expect(normalizeForMatch('   ')).toBe('');
  });
});

describe('matchesEscalationKeyword', () => {
  it('matches a single word on word boundary', () => {
    expect(
      matchesEscalationKeyword('can I talk to a human please', LIMITS.escalation_keywords),
    ).toBe('human');
  });
  it('does NOT match a substring inside another word', () => {
    // 'human' must not match 'humane'
    expect(
      matchesEscalationKeyword('that is not very humane', ['human']),
    ).toBeNull();
  });
  it('matches a multi-word phrase', () => {
    expect(
      matchesEscalationKeyword(
        'I would like to speak to a person now',
        LIMITS.escalation_keywords,
      ),
    ).toBe('speak to a person');
  });
  it('matches at start and end of utterance', () => {
    expect(
      matchesEscalationKeyword('lawyer', ['lawyer']),
    ).toBe('lawyer');
    expect(
      matchesEscalationKeyword('get me a lawyer', ['lawyer']),
    ).toBe('lawyer');
  });
  it('is punctuation-insensitive', () => {
    expect(
      matchesEscalationKeyword('STOP CALLING!!!', LIMITS.escalation_keywords),
    ).toBe('stop calling');
  });
  it('returns null when nothing matches', () => {
    expect(
      matchesEscalationKeyword('yes that sounds good', LIMITS.escalation_keywords),
    ).toBeNull();
  });
  it('ignores empty keywords', () => {
    expect(matchesEscalationKeyword('hello', ['', '   '])).toBeNull();
  });
});

describe('evaluateSessionGuard — precedence', () => {
  it('continue on a benign turn within limits', () => {
    const d = evaluateSessionGuard(
      { caller_turns: 3, elapsed_seconds: 40, last_caller_text: 'sure, tell me more' },
      LIMITS,
    );
    expect(d).toEqual({ action: 'continue' });
  });

  it('escalate beats max_turns when keyword present', () => {
    const d = evaluateSessionGuard(
      {
        caller_turns: 99, // also over max_turns
        elapsed_seconds: 10,
        last_caller_text: 'just get me a human',
      },
      LIMITS,
    );
    expect(d).toEqual({
      action: 'escalate',
      reason: 'keyword',
      matched: 'human',
    });
  });

  it('escalate beats max_call_seconds too', () => {
    const d = evaluateSessionGuard(
      {
        caller_turns: 2,
        elapsed_seconds: 9999,
        last_caller_text: 'I want to speak to a person',
      },
      LIMITS,
    );
    expect(d.action).toBe('escalate');
  });

  it('end on max_call_seconds (no keyword)', () => {
    const d = evaluateSessionGuard(
      { caller_turns: 2, elapsed_seconds: 300, last_caller_text: 'okay' },
      LIMITS,
    );
    expect(d).toEqual({ action: 'end', reason: 'max_call_seconds' });
  });

  it('max_call_seconds beats max_turns when both exceeded', () => {
    const d = evaluateSessionGuard(
      { caller_turns: 50, elapsed_seconds: 400, last_caller_text: 'ok' },
      LIMITS,
    );
    expect(d).toEqual({ action: 'end', reason: 'max_call_seconds' });
  });

  it('end on max_turns when only turns exceeded', () => {
    const d = evaluateSessionGuard(
      { caller_turns: 20, elapsed_seconds: 50, last_caller_text: 'ok' },
      LIMITS,
    );
    expect(d).toEqual({ action: 'end', reason: 'max_turns' });
  });

  it('boundary: exactly at max_turns ends (>=)', () => {
    expect(
      evaluateSessionGuard(
        { caller_turns: 20, elapsed_seconds: 1, last_caller_text: 'x' },
        LIMITS,
      ).action,
    ).toBe('end');
  });

  it('boundary: one below max_turns continues', () => {
    expect(
      evaluateSessionGuard(
        { caller_turns: 19, elapsed_seconds: 1, last_caller_text: 'x' },
        LIMITS,
      ),
    ).toEqual({ action: 'continue' });
  });

  it('empty escalation keyword list never escalates', () => {
    const d = evaluateSessionGuard(
      { caller_turns: 1, elapsed_seconds: 1, last_caller_text: 'I want a human lawyer' },
      { ...LIMITS, escalation_keywords: [] },
    );
    expect(d).toEqual({ action: 'continue' });
  });
});
