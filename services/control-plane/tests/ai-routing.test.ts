import { describe, expect, it } from 'vitest';
import {
  shouldRouteCallToAi,
  type AiRoutingInput,
} from '../src/ai-routing';

const GO: AiRoutingInput = {
  liveEnabled: true,
  aiPersonaId: 'p-1',
  personaEnabled: true,
  amdAction: 'bridge',
};

describe('shouldRouteCallToAi', () => {
  it('routes when every gate passes (bridge)', () => {
    expect(shouldRouteCallToAi(GO)).toBe(true);
  });

  it('routes when amd_action is the empty default', () => {
    expect(shouldRouteCallToAi({ ...GO, amdAction: '' })).toBe(true);
  });

  it('blocked when live flag off (master switch)', () => {
    expect(shouldRouteCallToAi({ ...GO, liveEnabled: false })).toBe(false);
  });

  it('blocked when no persona bound', () => {
    expect(shouldRouteCallToAi({ ...GO, aiPersonaId: null })).toBe(false);
    expect(
      shouldRouteCallToAi({ ...GO, aiPersonaId: undefined }),
    ).toBe(false);
    expect(shouldRouteCallToAi({ ...GO, aiPersonaId: '' })).toBe(false);
  });

  it('blocked when persona disabled', () => {
    expect(
      shouldRouteCallToAi({ ...GO, personaEnabled: false }),
    ).toBe(false);
  });

  it('blocked for non-conversational amd actions', () => {
    for (const a of [
      'voicemail',
      'audio_drop',
      'drop',
      'detect',
      'call_menu',
    ]) {
      expect(
        shouldRouteCallToAi({ ...GO, amdAction: a }),
      ).toBe(false);
    }
  });

  it('all-false is false', () => {
    expect(
      shouldRouteCallToAi({
        liveEnabled: false,
        aiPersonaId: null,
        personaEnabled: false,
        amdAction: 'voicemail',
      }),
    ).toBe(false);
  });
});
