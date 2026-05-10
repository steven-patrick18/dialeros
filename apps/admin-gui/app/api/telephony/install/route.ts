import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import {
  APP_SETTING_KEYS,
  appendAudit,
  getAppSetting,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INSTALL_SCRIPT = '/opt/dialeros/scripts/install-freeswitch.sh';
const TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes — apt + freeswitch package + start

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }

  const token = getAppSetting(APP_SETTING_KEYS.signalwireToken);
  if (!token) {
    return NextResponse.json(
      {
        error:
          'No SignalWire token saved. Save one in Settings → Telephony first.',
      },
      { status: 400 },
    );
  }

  const result = await runInstall(token);

  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'telephony.install_attempt',
    targetType: 'system',
    targetId: 'freeswitch',
    payload: { ok: result.ok, exitCode: result.exitCode },
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        exit_code: result.exitCode,
        log: result.log,
        error: 'Install script failed. See log.',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, log: result.log });
}

interface RunResult {
  ok: boolean;
  exitCode: number | null;
  log: string;
}

function runInstall(token: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('sudo', ['-n', INSTALL_SCRIPT], {
      env: { ...process.env, SIGNALWIRE_TOKEN: token, DEBIAN_FRONTEND: 'noninteractive' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let log = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      log += `\n[timeout after ${TIMEOUT_MS / 1000}s — killed]`;
      resolve({ ok: false, exitCode: null, log });
    }, TIMEOUT_MS);

    child.stdout?.on('data', (b) => {
      log += b.toString();
    });
    child.stderr?.on('data', (b) => {
      log += b.toString();
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      log += `\nspawn error: ${e.message}`;
      resolve({ ok: false, exitCode: null, log });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: code === 0, exitCode: code, log });
    });
  });
}
