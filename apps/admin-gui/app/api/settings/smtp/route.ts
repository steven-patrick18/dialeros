import { NextRequest, NextResponse } from 'next/server';
import { createRequire } from 'module';
import {
  MSMTPRC_PATH,
  appendAudit,
  getSmtpConfig,
  renderMsmtprc,
  setSmtpConfig,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 169 — SMTP relay settings. Admin only. GET returns the
// current values EXCEPT the password (just a password_set
// boolean; never echo the secret back). PUT validates +
// persists + re-renders /etc/msmtprc so changes take effect
// without a restart.
//
// Webpack defense: fs/promises imported via createRequire to
// dodge the node: scheme UnhandledSchemeError that bit iter 130.

type FsPromisesShape = {
  writeFile(path: string, data: string, opts?: { mode?: number }): Promise<void>;
};
const _require = createRequire(import.meta.url) as (m: string) => unknown;
const fsp = _require('fs/promises') as FsPromisesShape;

export async function GET() {
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
  const cfg = getSmtpConfig();
  return NextResponse.json({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    from: cfg.from,
    starttls: cfg.starttls,
    password_set: Boolean(cfg.password),
  });
}

export async function PUT(req: NextRequest) {
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
  const obj = body as {
    host?: unknown;
    port?: unknown;
    user?: unknown;
    password?: unknown;
    from?: unknown;
    starttls?: unknown;
  };

  // Validate before any writes — partial updates that fail
  // halfway leave /etc/msmtprc in an inconsistent state otherwise.
  if (obj.host !== undefined && typeof obj.host !== 'string') {
    return NextResponse.json({ error: 'host must be a string' }, { status: 400 });
  }
  if (obj.port !== undefined) {
    const n = Number(obj.port);
    if (!Number.isFinite(n) || n < 1 || n > 65535) {
      return NextResponse.json(
        { error: 'port must be 1-65535' },
        { status: 400 },
      );
    }
  }
  if (obj.user !== undefined && typeof obj.user !== 'string') {
    return NextResponse.json({ error: 'user must be a string' }, { status: 400 });
  }
  if (obj.from !== undefined && typeof obj.from !== 'string') {
    return NextResponse.json({ error: 'from must be a string' }, { status: 400 });
  }
  if (obj.starttls !== undefined && typeof obj.starttls !== 'boolean') {
    return NextResponse.json(
      { error: 'starttls must be a boolean' },
      { status: 400 },
    );
  }
  // password can be: undefined (don't touch), null (don't touch — same
  // intent), '' (clear), or a string (set new).

  setSmtpConfig({
    host: typeof obj.host === 'string' ? obj.host : undefined,
    port: obj.port !== undefined ? Number(obj.port) : undefined,
    user: typeof obj.user === 'string' ? obj.user : undefined,
    password:
      typeof obj.password === 'string'
        ? obj.password
        : obj.password === null
          ? null
          : undefined,
    from: typeof obj.from === 'string' ? obj.from : undefined,
    starttls:
      typeof obj.starttls === 'boolean' ? obj.starttls : undefined,
  });

  // Render the rc file. Fail explicitly if perms aren't right —
  // install-smtp.sh fixes /etc/msmtprc to 0640 root:dialeros so
  // the admin-gui (running as dialeros) can write.
  const cfg = getSmtpConfig();
  try {
    await fsp.writeFile(MSMTPRC_PATH, renderMsmtprc(cfg), { mode: 0o640 });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          `failed to write ${MSMTPRC_PATH}: ${(e as Error).message}. ` +
          `Run: sudo /opt/dialeros/scripts/install-smtp.sh`,
      },
      { status: 500 },
    );
  }

  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'settings.smtp.saved',
    targetType: 'app_setting',
    targetId: 'smtp',
    payload: {
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      from: cfg.from,
      starttls: cfg.starttls,
      password_set: Boolean(cfg.password),
    },
  });

  return NextResponse.json({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    from: cfg.from,
    starttls: cfg.starttls,
    password_set: Boolean(cfg.password),
  });
}
