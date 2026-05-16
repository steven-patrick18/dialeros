import { describe, expect, it } from 'vitest';
import { resolveQueueRoute } from '../src/ai-acd';

describe('resolveQueueRoute', () => {
  it('human wins whenever a human is free (AI never preempts)', () => {
    expect(
      resolveQueueRoute({
        humanAvailable: true,
        aiAssigned: true,
        aiLiveEnabled: true,
      }),
    ).toBe('human');
    expect(
      resolveQueueRoute({
        humanAvailable: true,
        aiAssigned: false,
        aiLiveEnabled: false,
      }),
    ).toBe('human');
  });

  it('AI fields only when no human + assigned + master live ON', () => {
    expect(
      resolveQueueRoute({
        humanAvailable: false,
        aiAssigned: true,
        aiLiveEnabled: true,
      }),
    ).toBe('ai');
  });

  it('hold when AI assigned but master switch OFF', () => {
    expect(
      resolveQueueRoute({
        humanAvailable: false,
        aiAssigned: true,
        aiLiveEnabled: false,
      }),
    ).toBe('hold');
  });

  it('hold when no human + no AI assigned', () => {
    expect(
      resolveQueueRoute({
        humanAvailable: false,
        aiAssigned: false,
        aiLiveEnabled: true,
      }),
    ).toBe('hold');
  });

  it('all false → hold', () => {
    expect(
      resolveQueueRoute({
        humanAvailable: false,
        aiAssigned: false,
        aiLiveEnabled: false,
      }),
    ).toBe('hold');
  });
});
