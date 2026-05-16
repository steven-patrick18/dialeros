import { describe, expect, it } from 'vitest';
import { aiSessionMonitorState } from '../src/ai-monitor';

describe('aiSessionMonitorState', () => {
  it('active + call_uuid → monitorable + seizable', () => {
    const s = aiSessionMonitorState({
      status: 'active',
      call_uuid: 'u-1',
      ended_at: null,
    });
    expect(s).toEqual({
      live: true,
      monitorable: true,
      seizable: true,
      reason: 'ok',
    });
  });

  it('active but no call_uuid yet → live, not monitorable', () => {
    const s = aiSessionMonitorState({
      status: 'active',
      call_uuid: null,
      ended_at: null,
    });
    expect(s.live).toBe(true);
    expect(s.monitorable).toBe(false);
    expect(s.seizable).toBe(false);
    expect(s.reason).toMatch(/no call_uuid/);
  });

  it('ended_at set despite active status → not live', () => {
    const s = aiSessionMonitorState({
      status: 'active',
      call_uuid: 'u-1',
      ended_at: '2026-05-16T00:00:00Z',
    });
    expect(s.live).toBe(false);
    expect(s.seizable).toBe(false);
  });

  it.each(['completed', 'escalated', 'aborted', 'seized'])(
    'terminal status %s → nothing actionable',
    (status) => {
      const s = aiSessionMonitorState({
        status,
        call_uuid: 'u-1',
        ended_at: null,
      });
      expect(s.live).toBe(false);
      expect(s.monitorable).toBe(false);
      expect(s.seizable).toBe(false);
      expect(s.reason).toBe(`session ${status}`);
    },
  );
});
