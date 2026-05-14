import { NextRequest, NextResponse } from 'next/server';
import { createRequire } from 'module';
import {
  appendAudit,
  getSmtpConfig,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 169 — Send a test email via the system MTA (msmtp on the
// VPS, configured by /etc/msmtprc). POST body: { to }.
// Admin only.

type ChildProcessShape = {
  spawn(
    bin: string,
    args: string[],
    opts?: { stdio?: unknown },
  ): {
    stdin: { write: (s: string) => void; end: () => void };
    stdout: { on: (e: string, cb: (c: Buffer) => void) => void };
    stderr: { on: (e: string, cb: (c: Buffer) => void) => void };
    on: (e: string, cb: (arg?: unknown) => void) => void;
  };
};
const _require = createRequire(import.meta.url) as (m: string) => unknown;
const cp = _require('child_process') as ChildProcessShape;

const SENDMAIL_BIN =
  process.env.SENDMAIL_BIN || '/usr/sbin/sendmail';

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin role required' },
      { status: 403 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const obj = body as { to?: unknown };
  const to = typeof obj.to === 'string' ? obj.to.trim() : '';
  if (!to || !to.includes('@')) {
    return NextResponse.json(
      { error: 'to must be a valid email address' },
      { status: 400 },
    );
  }
  const cfg = getSmtpConfig();
  if (!cfg.host || !cfg.user) {
    return NextResponse.json(
      {
        error:
          'SMTP not configured. Set host + user + password on this page first.',
      },
      { status: 400 },
    );
  }

  const subject = `DialerOS SMTP test — ${new Date().toISOString()}`;
  const fromHdr = cfg.from || cfg.user;
  const message = [
    `From: ${fromHdr}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    `This is a test message from your DialerOS admin GUI.`,
    `If you received this, the iter-169 SMTP relay is wired correctly.`,
    ``,
    `Configured relay: ${cfg.host}:${cfg.port}`,
    `Sent at: ${new Date().toISOString()}`,
  ].join('\n');

  const result = await new Promise<{
    code: number | null;
    stderr: string;
  }>((resolve) => {
    const proc = cp.spawn(SENDMAIL_BIN, ['-oi', '-t'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
      if (stderr.length > 16384) stderr = stderr.slice(stderr.length - 16384);
    });
    proc.on('error', (e) => {
      resolve({ code: -1, stderr: `spawn failed: ${(e as Error).message}` });
    });
    proc.on('close', (code) => {
      resolve({ code: typeof code === 'number' ? code : -1, stderr });
    });
    proc.stdin.write(message);
    proc.stdin.end();
  });

  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'settings.smtp.test_email',
    targetType: 'app_setting',
    targetId: 'smtp',
    payload: { to, ok: result.code === 0, stderr: result.stderr.slice(0, 500) },
  });

  if (result.code === 0) {
    return NextResponse.json({ ok: true, to });
  }
  return NextResponse.json(
    {
      ok: false,
      error: `sendmail exited ${result.code}: ${result.stderr.trim().slice(0, 600)}`,
    },
    { status: 502 },
  );
}
