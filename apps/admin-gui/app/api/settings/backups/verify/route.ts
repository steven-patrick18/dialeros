import { NextRequest, NextResponse } from 'next/server';
import { createRequire } from 'module';
import { appendAudit } from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 170 — POST /api/settings/backups/verify
// Admin only. systemctl-starts the dialeros-backup-verify
// service. The service runs synchronously (oneshot Type)
// and writes its result into backup_verifications via
// sqlite3 from within /opt/dialeros/scripts/verify-backup.sh.
//
// We don't shell out to verify-backup.sh directly here because
// it needs `User=dialeros` which is what the admin-gui already
// runs as — but a clean systemctl-start gives us proper journal
// logging, restart-policy, and the same execution environment
// (EnvironmentFile etc.) as the timer-fired runs.

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

  const result = await new Promise<{ code: number; stderr: string }>(
    (resolve) => {
      const proc = cp.spawn(
        SYSTEMCTL,
        ['start', 'dialeros-backup-verify.service'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stderr = '';
      proc.stderr.on('data', (c: Buffer) => {
        stderr += c.toString();
      });
      proc.on('error', (e) =>
        resolve({ code: -1, stderr: (e as Error).message }),
      );
      proc.on('close', (code) =>
        resolve({
          code: typeof code === 'number' ? code : -1,
          stderr,
        }),
      );
    },
  );

  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'settings.backups.verify_triggered',
    targetType: 'app_setting',
    targetId: 'backups',
    payload: { code: result.code, stderr: result.stderr.slice(0, 400) },
  });

  if (result.code !== 0) {
    return NextResponse.json(
      {
        error:
          result.code === -1 && /not authorized|denied/i.test(result.stderr)
            ? 'systemctl access denied. Add a polkit rule allowing dialeros to manage dialeros-backup-verify.service, or run the script manually: sudo systemctl start dialeros-backup-verify.service'
            : `systemctl exited ${result.code}: ${result.stderr.trim().slice(0, 400)}`,
      },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
