import { describe, expect, it } from 'vitest';
import {
  buildOllamaMessages,
  callerTurnCount,
  MAX_HISTORY_TURNS,
  type ConversationTurn,
} from '../src/ai-conversation';

const PERSONA = {
  system_prompt: 'You are a terse scheduling agent.',
  greeting: 'Hi, Acme scheduling — quick minute?',
};

describe('buildOllamaMessages — structure', () => {
  it('system first, greeting as opening assistant msg, caller line last', () => {
    const m = buildOllamaMessages(PERSONA, [], 'who is this?');
    // Iter 200 — system msg now wraps the persona prompt with
    // the always-on behaviour guard (+ identity guard). Assert
    // role + that the persona script is contained, not raw-equal.
    expect(m[0].role).toBe('system');
    expect(m[0].content).toContain(PERSONA.system_prompt);
    expect(m[0].content).toContain('BEHAVIOR (strict');
    expect(m[1]).toEqual({
      role: 'assistant',
      content: PERSONA.greeting,
    });
    expect(m[m.length - 1]).toEqual({
      role: 'user',
      content: 'who is this?',
    });
    expect(m).toHaveLength(3);
  });

  it('maps caller→user and ai→assistant in order', () => {
    const hist: ConversationTurn[] = [
      { role: 'caller', text: 'who is this' },
      { role: 'ai', text: 'Acme scheduling' },
      { role: 'caller', text: 'not interested' },
    ];
    const m = buildOllamaMessages(PERSONA, hist, 'maybe later');
    expect(m.slice(2)).toEqual([
      { role: 'user', content: 'who is this' },
      { role: 'assistant', content: 'Acme scheduling' },
      { role: 'user', content: 'not interested' },
      { role: 'user', content: 'maybe later' },
    ]);
  });

  it('skips empty / whitespace / unknown-role turns', () => {
    const hist: ConversationTurn[] = [
      { role: 'caller', text: '   ' },
      { role: 'system', text: 'noise' },
      { role: 'ai', text: '' },
      { role: 'caller', text: 'real line' },
    ];
    const m = buildOllamaMessages(PERSONA, hist, 'final');
    // system + greeting + 'real line' + 'final'
    expect(m).toHaveLength(4);
    expect(m[2]).toEqual({ role: 'user', content: 'real line' });
  });
});

describe('buildOllamaMessages — history truncation', () => {
  it('keeps only the most recent maxHistory mapped turns', () => {
    const hist: ConversationTurn[] = [];
    for (let i = 0; i < 50; i++) {
      hist.push({
        role: i % 2 === 0 ? 'caller' : 'ai',
        text: `turn ${i}`,
      });
    }
    const m = buildOllamaMessages(PERSONA, hist, 'now', 10);
    // system + greeting + 10 history + final user = 13
    expect(m).toHaveLength(13);
    // oldest kept is turn 40 (last 10 of 0..49)
    expect(m[2].content).toBe('turn 40');
    expect(m[11].content).toBe('turn 49');
    expect(m[12]).toEqual({ role: 'user', content: 'now' });
  });

  it('default cap is MAX_HISTORY_TURNS', () => {
    const hist: ConversationTurn[] = Array.from(
      { length: MAX_HISTORY_TURNS + 8 },
      (_, i) => ({ role: 'caller' as const, text: `c${i}` }),
    );
    const m = buildOllamaMessages(PERSONA, hist, 'x');
    expect(m).toHaveLength(2 + MAX_HISTORY_TURNS + 1);
  });

  it('no truncation when under the cap', () => {
    const hist: ConversationTurn[] = [
      { role: 'caller', text: 'a' },
      { role: 'ai', text: 'b' },
    ];
    const m = buildOllamaMessages(PERSONA, hist, 'c');
    expect(m).toHaveLength(5);
  });
});

describe('callerTurnCount', () => {
  it('counts caller turns + the current one by default', () => {
    const hist: ConversationTurn[] = [
      { role: 'caller', text: '1' },
      { role: 'ai', text: 'r' },
      { role: 'caller', text: '2' },
    ];
    expect(callerTurnCount(hist)).toBe(3);
    expect(callerTurnCount(hist, false)).toBe(2);
  });
  it('handles empty history', () => {
    expect(callerTurnCount([])).toBe(1);
    expect(callerTurnCount([], false)).toBe(0);
  });
});
