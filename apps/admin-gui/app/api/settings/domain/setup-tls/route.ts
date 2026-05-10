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

const SCRIPT = '/opt/dialeros/scripts/setup-tls.sh';
const TIMEOUT_MS = 8 * 60 * 1000;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const domain = getAppSetting(APP_SETTING_KEYS.canonicalDomain);
  if (!domain) {
    return NextResponse.json(
      { ok: false, error: 'Save a domain first.' },
      { status: 400 },
    );
  }
  const email =
    getAppSetting(APP_SETTING_KEYS.tlsContactEmail) ?? `admin@${domain}`;

  const result = await runScript({ domain, email });

  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'settings.tls.setup',
    targetType: 'system',
    targetId: 'tls',
    payload: { ok: result.ok, exit_code: result.exitCode, domain },
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        exit_code: result.exitCode,
        log: result.log,
        error: 'TLS setup failed. See log.',
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

function runScript(env: { domain: string; email: string }): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(
      'sudo',
      [
        '-n',
        '--preserve-env=DIALEROS_DOMAIN,DIALEROS_TLS_EMAIL,DEBIAN_FRONTEND',
        SCRIPT,
      ],
      {
        env: {
          ...process.env,
          DIALEROS_DOMAIN: env.domain,
          DIALEROS_TLS_EMAIL: env.email,
          DEBIAN_FRONTEND: 'noninteractive',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

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
