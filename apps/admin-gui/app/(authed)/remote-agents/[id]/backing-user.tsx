'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface BackingUser {
  user_id: string;
  username: string;
  display_name: string | null;
  is_active: boolean;
  phone_id: string | null;
  extension: string | null;
}

interface ProvisionedCreds {
  user_id: string;
  username: string;
  phone_id: string;
  extension: string;
  sip_password: string;
  login_password: string;
}

export function BackingUserPanel({
  remoteAgentId,
  extension,
  existing,
}: {
  remoteAgentId: string;
  extension: string | null;
  existing: BackingUser | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [creds, setCreds] = useState<ProvisionedCreds | null>(null);

  async function provision() {
    setBusy(true);
    setErr(null);
    const res = await fetch(
      `/api/remote-agents/${remoteAgentId}/provision-user`,
      { method: 'POST' },
    );
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(j.error ?? `Failed (${res.status})`);
      return;
    }
    const j = (await res.json()) as ProvisionedCreds;
    setCreds(j);
    router.refresh();
  }

  async function unlink() {
    if (
      !confirm(
        'Unlink the backing user from this remote agent? The user + phone remain — only the link is removed.',
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(
      `/api/remote-agents/${remoteAgentId}/unlink-user`,
      { method: 'POST' },
    );
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(j.error ?? `Failed (${res.status})`);
      return;
    }
    setCreds(null);
    router.refresh();
  }

  // Just-provisioned state — show the one-time credentials.
  if (creds) {
    return (
      <div className="border border-success/50 bg-success/10 rounded p-4 space-y-3">
        <div>
          <h2 className="text-xs uppercase tracking-wide text-success mb-1">
            Backing user provisioned
          </h2>
          <p className="text-xs text-fg-muted">
            Save these credentials now — the SIP password and login
            password are returned ONCE and aren&apos;t retrievable
            afterwards. The user can also log in via the web at{' '}
            <Link href="/agent" className="underline">
              /agent
            </Link>{' '}
            using the login password.
          </p>
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm font-mono">
          <dt className="text-fg-subtle">Username</dt>
          <dd>{creds.username}</dd>
          <dt className="text-fg-subtle">Extension</dt>
          <dd>{creds.extension}</dd>
          <dt className="text-fg-subtle">SIP password</dt>
          <dd>{creds.sip_password}</dd>
          <dt className="text-fg-subtle">Login password</dt>
          <dd>{creds.login_password}</dd>
        </dl>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setCreds(null)}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm"
          >
            I&apos;ve saved them
          </button>
          <Link
            href={`/users/${creds.user_id}`}
            className="text-xs text-fg-muted hover:text-fg underline"
          >
            Open user →
          </Link>
        </div>
      </div>
    );
  }

  // Linked state — show the user reference.
  if (existing) {
    return (
      <div className="border border-border rounded p-4">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Backing user
        </h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-fg-subtle">Username</dt>
          <dd>
            <Link
              href={`/users/${existing.user_id}`}
              className="font-mono hover:underline"
            >
              {existing.username}
            </Link>
            {existing.display_name && (
              <span className="text-fg-subtle ml-2 text-xs">
                ({existing.display_name})
              </span>
            )}
            {!existing.is_active && (
              <span className="ml-2 text-warn text-[10px] uppercase">
                inactive
              </span>
            )}
          </dd>
          <dt className="text-fg-subtle">Extension</dt>
          <dd className="font-mono">{existing.extension ?? '—'}</dd>
        </dl>
        <p className="text-xs text-fg-subtle mt-3">
          Calls bridged to{' '}
          <span className="font-mono">
            user/{existing.extension ?? '?'}
          </span>{' '}
          land on whatever endpoint (browser softphone or hard phone)
          is currently registered for this user. The user can also be
          attached as an active agent on campaigns through{' '}
          <Link
            href={`/users/${existing.user_id}`}
            className="underline hover:text-fg"
          >
            /users/{existing.username}
          </Link>
          .
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={unlink}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-border text-fg-muted hover:text-error hover:border-error/50 disabled:opacity-40"
          >
            {busy ? '…' : 'Unlink user'}
          </button>
          {err && <span className="text-xs text-error">{err}</span>}
        </div>
      </div>
    );
  }

  // Unlinked state — provision button.
  return (
    <div className="border border-border rounded p-4">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
        Backing user
      </h2>
      <p className="text-xs text-fg-subtle mb-3">
        This remote agent has no backing user identity yet.
        Provisioning creates a User (role agent, same name) and a
        Phone at extension{' '}
        <span className="font-mono">{extension ?? '?'}</span> so a
        hard phone (or softphone) can register and accept bridged
        calls. The one-time SIP + login passwords are returned by
        this action — save them somewhere safe.
      </p>
      <button
        type="button"
        onClick={provision}
        disabled={busy || !extension}
        className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-40"
      >
        {busy ? 'Provisioning…' : 'Provision user + phone'}
      </button>
      {!extension && (
        <p className="text-xs text-warn mt-2">
          Set an extension on the remote agent first (Lines field
          above) — the phone needs a target.
        </p>
      )}
      {err && <p className="text-xs text-error mt-2">{err}</p>}
    </div>
  );
}
