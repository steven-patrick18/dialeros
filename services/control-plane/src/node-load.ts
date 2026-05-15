// Iter 191 — Real-time per-node load gathering.
//
// Probes every cluster node for CPU load / RAM / disk / FS
// channels / uptime. The is_self node is probed locally (sh -c,
// no SSH overhead); remote nodes via ssh using the cluster
// bootstrap key already distributed by the iter-8 provisioner.
//
// Per-node timeout-bounded + run in parallel so one dead node
// can't hang the dashboard. webpack 'node:' scheme is dodged
// with the same createRequire pattern db.ts / call-menu-deploy.ts
// use.

import { createRequire } from 'module';
import type { NodeRecord } from './schema';
import { listNodesFromDb } from './db';

type ExecCb = (
  err: (Error & { code?: number }) | null,
  stdout: string,
  stderr: string,
) => void;
type ChildProcessShape = {
  execFile(
    file: string,
    args: string[],
    options: { timeout: number; maxBuffer: number },
    cb: ExecCb,
  ): unknown;
};
const _require = createRequire(import.meta.url) as (m: string) => unknown;
const cp = _require('child_process') as ChildProcessShape;

// POSIX probe — GNU coreutils (Debian/Ubuntu nodes). Emits one
// compact JSON line. awk programs are SINGLE-quoted so the shell
// never touches awk's `$N` field refs (the prior double-quoted
// form got mangled through sh→awk→ssh, returning empty mem/disk).
// Single quotes survive both `sh -c <str>` (execFile passes the
// string as one argv element) and the ssh path (remote sh
// re-parses; single-quoted awk is standard). fs_cli is
// best-effort: 0 on a web-only node with no FreeSWITCH.
//   df --output=used,size avoids field-index ambiguity across
//   df versions; tail -1 drops the header row.
export const NODE_PROBE_SH = [
  'L=$(cut -d" " -f1-3 /proc/loadavg)',
  'C=$(nproc 2>/dev/null || echo 1)',
  "M=$(free -b 2>/dev/null | awk '/^Mem:/{print $3\" \"$2}')",
  'D=$(df -B1 --output=used,size / 2>/dev/null | tail -1)',
  'U=$(cut -d. -f1 /proc/uptime)',
  "F=$(fs_cli -x 'show channels count' 2>/dev/null | grep -oE '^[0-9]+' | head -1)",
  'printf \'{"load":"%s","cpus":%s,"mem":"%s","disk":"%s","uptime":%s,"fs":%s}\\n\' "$L" "$C" "$M" "$D" "$U" "${F:-0}"',
].join('; ');

export interface NodeLoadSnapshot {
  node_id: string;
  name: string;
  host: string;
  role: string;
  is_self: boolean;
  status: string;
  reachable: boolean;
  probe_ms: number;
  detail?: string;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  cpus: number | null;
  // load1 / cpus, clamped 0..∞; the headline "how hot is this box".
  load_ratio: number | null;
  mem_used: number | null;
  mem_total: number | null;
  disk_used: number | null;
  disk_total: number | null;
  uptime_s: number | null;
  fs_channels: number | null;
}

/** Pure parser for the probe's JSON line. Defensive — any field
 * that doesn't parse becomes null rather than throwing, so a
 * partial probe still renders a useful card. Exported for tests. */
export function parseProbeOutput(
  raw: string,
): Pick<
  NodeLoadSnapshot,
  | 'load1'
  | 'load5'
  | 'load15'
  | 'cpus'
  | 'load_ratio'
  | 'mem_used'
  | 'mem_total'
  | 'disk_used'
  | 'disk_total'
  | 'uptime_s'
  | 'fs_channels'
> {
  const empty = {
    load1: null,
    load5: null,
    load15: null,
    cpus: null,
    load_ratio: null,
    mem_used: null,
    mem_total: null,
    disk_used: null,
    disk_total: null,
    uptime_s: null,
    fs_channels: null,
  };
  let obj: Record<string, unknown>;
  try {
    // The probe may print warnings before the JSON; take the last
    // {...} line.
    const line = raw
      .trim()
      .split('\n')
      .reverse()
      .find((l) => l.trim().startsWith('{'));
    if (!line) return empty;
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return empty;
  }
  const nums = (s: unknown): number[] =>
    typeof s === 'string'
      ? s
          .trim()
          .split(/\s+/)
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n))
      : [];
  const loads = nums(obj.load);
  const mem = nums(obj.mem);
  const disk = nums(obj.disk);
  const cpus =
    typeof obj.cpus === 'number' && obj.cpus > 0 ? obj.cpus : null;
  const load1 = loads[0] ?? null;
  return {
    load1,
    load5: loads[1] ?? null,
    load15: loads[2] ?? null,
    cpus,
    load_ratio:
      load1 != null && cpus ? Math.round((load1 / cpus) * 100) / 100 : null,
    mem_used: mem[0] ?? null,
    mem_total: mem[1] ?? null,
    disk_used: disk[0] ?? null,
    disk_total: disk[1] ?? null,
    uptime_s:
      typeof obj.uptime === 'number' && obj.uptime >= 0
        ? obj.uptime
        : null,
    fs_channels:
      typeof obj.fs === 'number' && obj.fs >= 0 ? obj.fs : null,
  };
}

function execProbe(
  node: NodeRecord,
  timeoutMs: number,
): Promise<{ stdout: string; ms: number; err?: string }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const local = node.is_self === 1;
    const file = local ? 'sh' : 'ssh';
    const args = local
      ? ['-c', NODE_PROBE_SH]
      : [
          '-o',
          'BatchMode=yes',
          '-o',
          'StrictHostKeyChecking=accept-new',
          '-o',
          `ConnectTimeout=${Math.ceil(timeoutMs / 1000)}`,
          '-p',
          String(node.port),
          `${node.ssh_user}@${node.host}`,
          NODE_PROBE_SH,
        ];
    cp.execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 },
      (err, stdout, stderr) => {
        const ms = Date.now() - start;
        if (err) {
          resolve({
            stdout: stdout || '',
            ms,
            err:
              (err.message || 'probe failed').split('\n')[0] +
              (stderr ? ` (${stderr.trim().split('\n')[0]})` : ''),
          });
          return;
        }
        resolve({ stdout: stdout || '', ms });
      },
    );
  });
}

export async function gatherNodeLoad(
  node: NodeRecord,
  timeoutMs = 4000,
): Promise<NodeLoadSnapshot> {
  const base: NodeLoadSnapshot = {
    node_id: node.id,
    name: node.name,
    host: node.host,
    role: node.role,
    is_self: node.is_self === 1,
    status: node.status,
    reachable: false,
    probe_ms: 0,
    load1: null,
    load5: null,
    load15: null,
    cpus: null,
    load_ratio: null,
    mem_used: null,
    mem_total: null,
    disk_used: null,
    disk_total: null,
    uptime_s: null,
    fs_channels: null,
  };
  const { stdout, ms, err } = await execProbe(node, timeoutMs);
  base.probe_ms = ms;
  if (err && !stdout.includes('{')) {
    base.detail = err;
    return base;
  }
  const parsed = parseProbeOutput(stdout);
  // Reachable = we got a parseable loadavg back.
  base.reachable = parsed.load1 != null;
  if (!base.reachable && err) base.detail = err;
  return { ...base, ...parsed };
}

/** Probe every node in parallel; per-node timeout means one dead
 * box never stalls the dashboard. */
export async function gatherAllNodeLoad(
  timeoutMs = 4000,
): Promise<NodeLoadSnapshot[]> {
  const nodes = listNodesFromDb();
  return Promise.all(nodes.map((n) => gatherNodeLoad(n, timeoutMs)));
}
