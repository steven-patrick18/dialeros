import { describe, expect, it } from 'vitest';
import {
  resolveTransfer,
  buildTransferSignalText,
  shouldLearnTransferRule,
  TRANSFER_MIN_SCORE,
} from '../src/ai-transfer';

describe('resolveTransfer', () => {
  it('empty / non-array -> no transfer', () => {
    expect(resolveTransfer([])).toEqual({ transfer: false });
    expect(
      resolveTransfer(null as unknown as []),
    ).toEqual({ transfer: false });
  });
  it('best hit below threshold -> no transfer', () => {
    expect(
      resolveTransfer([{ reason: 'keyword', score: 0.4 }]),
    ).toEqual({ transfer: false });
  });
  it('best hit at / above threshold -> transfer + reason', () => {
    const d = resolveTransfer([
      { reason: 'escalate:billing', score: TRANSFER_MIN_SCORE },
    ]);
    expect(d).toEqual({
      transfer: true,
      reason: 'escalate:billing',
      score: TRANSFER_MIN_SCORE,
    });
  });
  it('only the FIRST (best) hit decides', () => {
    expect(
      resolveTransfer([
        { reason: 'weak', score: 0.1 },
        { reason: 'strong', score: 0.99 },
      ]),
    ).toEqual({ transfer: false });
  });
  it('NaN / non-number score -> no transfer', () => {
    expect(
      resolveTransfer([{ reason: 'x', score: NaN }]),
    ).toEqual({ transfer: false });
    expect(
      resolveTransfer([
        { reason: 'x', score: 'hi' as unknown as number },
      ]),
    ).toEqual({ transfer: false });
  });
  it('blank reason falls back to "learned"', () => {
    expect(
      resolveTransfer([{ reason: '   ', score: 0.9 }]),
    ).toEqual({ transfer: true, reason: 'learned', score: 0.9 });
  });
  it('custom minScore respected', () => {
    expect(
      resolveTransfer([{ reason: 'r', score: 0.5 }], 0.4).transfer,
    ).toBe(true);
    expect(
      resolveTransfer([{ reason: 'r', score: 0.5 }], 0.6).transfer,
    ).toBe(false);
  });
  it('threshold is a high bar (never trivially fires)', () => {
    expect(TRANSFER_MIN_SCORE).toBeGreaterThanOrEqual(0.55);
    expect(TRANSFER_MIN_SCORE).toBeLessThanOrEqual(0.95);
  });
});

describe('buildTransferSignalText', () => {
  it('non-array / no caller lines -> empty', () => {
    expect(buildTransferSignalText(null as unknown as [])).toBe('');
    expect(buildTransferSignalText([])).toBe('');
    expect(
      buildTransferSignalText([{ role: 'ai', text: 'hello' }]),
    ).toBe('');
  });
  it('takes the LAST substantive caller line', () => {
    expect(
      buildTransferSignalText([
        { role: 'caller', text: 'hi there' },
        { role: 'ai', text: 'how can I help' },
        { role: 'caller', text: 'I need to dispute a charge please' },
      ]),
    ).toBe('I need to dispute a charge please');
  });
  it('terse last line -> joins the last few caller lines', () => {
    const t = buildTransferSignalText([
      { role: 'caller', text: 'my bill is wrong and overcharged' },
      { role: 'ai', text: 'I can look' },
      { role: 'caller', text: 'no a person' },
      { role: 'caller', text: 'yes' },
    ]);
    expect(t).toContain('my bill is wrong');
    expect(t).toContain('yes');
  });
  it('skips blank / non-caller turns', () => {
    expect(
      buildTransferSignalText([
        { role: 'system', text: 'ignored' },
        { role: 'caller', text: '   ' },
        { role: 'caller', text: 'connect me to support team now' },
      ]),
    ).toBe('connect me to support team now');
  });
  it('caps at maxChars', () => {
    const t = buildTransferSignalText(
      [{ role: 'caller', text: 'z'.repeat(900) }],
      50,
    );
    expect(t.length).toBe(50);
  });
});

describe('shouldLearnTransferRule', () => {
  const ok = {
    status: 'escalated',
    alreadyMined: false,
    signalText: 'I want to speak to a human',
  };
  it('escalated + unmined + substantive signal -> true', () => {
    expect(shouldLearnTransferRule(ok)).toBe(true);
  });
  it('already mined -> false', () => {
    expect(
      shouldLearnTransferRule({ ...ok, alreadyMined: true }),
    ).toBe(false);
  });
  it('non-escalated status -> false', () => {
    expect(
      shouldLearnTransferRule({ ...ok, status: 'completed' }),
    ).toBe(false);
  });
  it('thin signal (<8 chars) -> false', () => {
    expect(
      shouldLearnTransferRule({ ...ok, signalText: 'help' }),
    ).toBe(false);
  });
});
