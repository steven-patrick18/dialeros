import { describe, expect, it } from 'vitest';
import { parseProbeOutput } from '../src/node-load';

describe('parseProbeOutput', () => {
  it('parses a well-formed probe line', () => {
    const raw =
      '{"load":"0.42 0.55 0.61","cpus":5,"mem":"1048576 6291456","disk":"23622320128 174063288320","uptime":527040,"fs":3}';
    const p = parseProbeOutput(raw);
    expect(p.load1).toBe(0.42);
    expect(p.load5).toBe(0.55);
    expect(p.load15).toBe(0.61);
    expect(p.cpus).toBe(5);
    expect(p.load_ratio).toBe(0.08); // 0.42/5 → 0.084 → 0.08
    expect(p.mem_used).toBe(1048576);
    expect(p.mem_total).toBe(6291456);
    expect(p.disk_used).toBe(23622320128);
    expect(p.disk_total).toBe(174063288320);
    expect(p.uptime_s).toBe(527040);
    expect(p.fs_channels).toBe(3);
  });

  it('takes the last JSON line when warnings precede it', () => {
    const raw =
      'Warning: something on stderr merged\nbash: fs_cli: noise\n{"load":"1.00 1.00 1.00","cpus":2,"mem":"100 200","disk":"5 10","uptime":99,"fs":0}';
    const p = parseProbeOutput(raw);
    expect(p.load1).toBe(1);
    expect(p.cpus).toBe(2);
    expect(p.load_ratio).toBe(0.5);
    expect(p.fs_channels).toBe(0);
  });

  it('returns all-null on empty / non-JSON', () => {
    for (const raw of ['', '   ', 'not json at all', 'ssh: connect refused']) {
      const p = parseProbeOutput(raw);
      expect(p.load1).toBeNull();
      expect(p.cpus).toBeNull();
      expect(p.load_ratio).toBeNull();
      expect(p.mem_used).toBeNull();
      expect(p.fs_channels).toBeNull();
    }
  });

  it('returns all-null on malformed JSON', () => {
    const p = parseProbeOutput('{"load":"0.1 0.2 0.3", cpus:}');
    expect(p.load1).toBeNull();
  });

  it('handles missing fields gracefully (partial probe)', () => {
    const p = parseProbeOutput('{"load":"0.30 0.20 0.10","cpus":4}');
    expect(p.load1).toBe(0.3);
    expect(p.cpus).toBe(4);
    expect(p.load_ratio).toBe(0.08); // 0.3/4 = 0.075 → 0.08
    expect(p.mem_used).toBeNull();
    expect(p.disk_total).toBeNull();
    expect(p.uptime_s).toBeNull();
    expect(p.fs_channels).toBeNull();
  });

  it('load_ratio is null when cpus is zero or missing', () => {
    expect(
      parseProbeOutput('{"load":"1.0 1.0 1.0","cpus":0}').load_ratio,
    ).toBeNull();
    expect(
      parseProbeOutput('{"load":"1.0 1.0 1.0"}').load_ratio,
    ).toBeNull();
  });

  it('rejects negative / non-finite numeric fields', () => {
    const p = parseProbeOutput(
      '{"load":"0.5 0.5 0.5","cpus":2,"uptime":-1,"fs":-3}',
    );
    expect(p.uptime_s).toBeNull();
    expect(p.fs_channels).toBeNull();
  });

  it('tolerates extra whitespace in space-joined fields', () => {
    const p = parseProbeOutput(
      '{"load":"  0.10   0.20  0.30 ","cpus":1,"mem":" 5  10 ","disk":"1 2","uptime":1,"fs":0}',
    );
    expect(p.load1).toBe(0.1);
    expect(p.load15).toBe(0.3);
    expect(p.mem_used).toBe(5);
    expect(p.mem_total).toBe(10);
  });
});
