import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 171 — Timer health dashboard backend.
//
// GET /api/settings/timers — admin+supervisor. Returns the
// state of every dialeros-*.timer plus its paired service:
//   - active (timer state)
//   - next_run_iso, last_run_iso (from list-timers)
//   - service result + exit code (from show)
//   - description
//
// Pure read; never mutates. Both systemctl subcommands work for
// the dialeros user without sudo (verified live).
//
// Webpack defense: child_process via createRequire to dodge the
// node: scheme UnhandledSchemeError that bit iter 130/152.

type ChildProcessShape = {
  spawn(
    bin: string,
    args: string[],
    opts?: { stdio?: unknown },
  ): {
    stdout: { on: (e: string, cb: (c: Buffer) => void) => void };
    stderr: { on: (e: string, cb: (c: Buffer) => void) => void };
    on: (e: string, cb: (arg?: unknown) => void) => void;
  };
};
const _require = createRequire(import.meta.url) as (m: string) => unknown;
const cp = _require('child_process') as ChildProcessShape;
const SYSTEMCTL = process.env.SYSTEMCTL_BIN || '/usr/bin/systemctl';

interface TimerInfo {
  timer_unit: string;
  service_unit: string;
  active: boolean;
  next_run_iso: string | null;
  last_run_iso: string | null;
  next_run_relative: string | null;
  last_run_relative: string | null;
  description: string | null;
  service_result: string | null;
  service_exit_code: number | null;
  service_active_state: string | null;
}

function run(bin: string, args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve) => {
    const proc = cp.spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    proc.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
      if (stdout.length > 65536) stdout = stdout.slice(stdout.length - 65536);
    });
    proc.on('error', () => resolve({ stdout: '' }));
    proc.on('close', () => resolve({ stdout }));
  });
}

function parseSystemctlDate(s: string): string | null {
  if (!s || s === '-' || s === 'n/a' || s === '0') return null;
  // Format: "Thu 2026-05-14 06:00:39 EDT"
  const d = new Date(s);
  if (Number.isFinite(d.getTime())) return d.toISOString();
  return null;
}

async function loadServiceProps(serviceUnit: string): Promise<{
  description: string | null;
  result: string | null;
  exit_code: number | null;
  active_state: string | null;
}> {
  const { stdout } = await run(SYSTEMCTL, [
    'show',
    serviceUnit,
    '-p',
    'Description,Result,ExecMainStatus,ActiveState',
  ]);
  const props: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    props[line.slice(0, idx)] = line.slice(idx + 1);
  }
  const exit_code = props.ExecMainStatus
    ? Number(props.ExecMainStatus)
    : null;
  return {
    description: props.Description || null,
    result: props.Result || null,
    exit_code: Number.isFinite(exit_code) ? exit_code : null,
    active_state: props.ActiveState || null,
  };
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return NextResponse.json(
      { error: 'Admin or supervisor role required' },
      { status: 403 },
    );
  }

  // list-timers output: NEXT, LEFT, LAST, PASSED, UNIT, ACTIVATES
  // Tab-or-whitespace-separated; the dates carry inner spaces so
  // we parse from the LEFT (timer unit name) and ACTIVATES (service
  // name) at the END of each line. Width-based parsing is unreliable
  // across systemd versions; safer: split on >=2 spaces, then
  // recombine middle pieces if there are extras.
  const { stdout: timersOut } = await run(SYSTEMCTL, [
    'list-timers',
    '--no-legend',
    '--no-pager',
    '--all',
    'dialeros-*.timer',
  ]);

  const timers: TimerInfo[] = [];
  for (const rawLine of timersOut.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // Use a regex to capture the trailing two unit names + everything else.
    const m = /^(.*?)\s+(dialeros-\S+\.timer)\s+(dialeros-\S+\.service)\s*$/.exec(
      line,
    );
    if (!m) continue;
    const datePart = m[1]!.trim();
    const timer_unit = m[2]!;
    const service_unit = m[3]!;
    // Split datePart on the first run of 2+ spaces; pieces are:
    //   NEXT (with day-of-week prefix), LEFT, LAST, PASSED
    // Some systemd versions add an extra column; we handle 4 or 5.
    const parts = datePart.split(/ {2,}/);
    let next: string | null = null;
    let next_rel: string | null = null;
    let last: string | null = null;
    let last_rel: string | null = null;
    if (parts.length >= 4) {
      next = parseSystemctlDate(parts[0]!);
      next_rel = parts[1] || null;
      last = parts[2] === '-' ? null : parseSystemctlDate(parts[2]!);
      last_rel = parts[3] === '-' ? null : parts[3] || null;
    }
    const props = await loadServiceProps(service_unit);
    timers.push({
      timer_unit,
      service_unit,
      active: props.active_state === 'active' || props.active_state === 'inactive',
      // 'inactive' for a oneshot is normal (it ran and exited). Treat
      // failed as the alarm signal — surfaced via service_result.
      next_run_iso: next,
      last_run_iso: last,
      next_run_relative: next_rel,
      last_run_relative: last_rel,
      description: props.description,
      service_result: props.result,
      service_exit_code: props.exit_code,
      service_active_state: props.active_state,
    });
  }

  // Sort: failures first, then by next-run-soonest.
  timers.sort((a, b) => {
    const aFail = a.service_result && a.service_result !== 'success' ? 0 : 1;
    const bFail = b.service_result && b.service_result !== 'success' ? 0 : 1;
    if (aFail !== bFail) return aFail - bFail;
    const an = a.next_run_iso ? Date.parse(a.next_run_iso) : Infinity;
    const bn = b.next_run_iso ? Date.parse(b.next_run_iso) : Infinity;
    return an - bn;
  });

  return NextResponse.json({ timers });
}
