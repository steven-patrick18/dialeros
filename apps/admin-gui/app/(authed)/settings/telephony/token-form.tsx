'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function TokenForm({ hasToken }: { hasToken: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/settings/signalwire-token', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tone: 'err', text: j.error ?? `failed (${res.status})` });
        return;
      }
      setMsg({ tone: 'ok', text: 'Token saved (encrypted at rest).' });
      setToken('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!confirm('Clear the saved SignalWire token?')) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/settings/signalwire-token', {
        method: 'DELETE',
      });
      if (!res.ok) {
        setMsg({ tone: 'err', text: `failed (${res.status})` });
        return;
      }
      setMsg({ tone: 'ok', text: 'Token cleared.' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded p-4">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
        SignalWire token
      </h2>
      <p className="text-xs text-fg-subtle mb-3">
        FreeSWITCH installs from SignalWire&apos;s apt repo, which requires
        a free Personal Access Token. Sign up at{' '}
        <a
          href="https://signalwire.com/"
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          signalwire.com
        </a>{' '}
        &rarr; Personal Access Tokens. Stored AES-256-GCM-encrypted at
        rest; never sent back to the browser.
      </p>

      <div className="text-xs text-fg-subtle mb-3">
        Status:{' '}
        {hasToken ? (
          <span className="text-success">Token saved</span>
        ) : (
          <span className="text-warn">No token saved</span>
        )}
      </div>

      <label className="block mb-3">
        <div className="text-sm font-medium mb-1">
          {hasToken ? 'Replace token' : 'Token'}
        </div>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={
            hasToken
              ? 'Leave blank to keep existing'
              : 'PT-...'
          }
          className="input font-mono text-sm w-full"
          autoComplete="off"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || token.length === 0}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save token'}
        </button>
        {hasToken && (
          <button
            type="button"
            onClick={clear}
            disabled={busy}
            className="text-xs text-error hover:underline disabled:opacity-50"
          >
            Clear saved token
          </button>
        )}
        {msg && (
          <span
            className={`text-xs ${
              msg.tone === 'ok' ? 'text-success' : 'text-error'
            }`}
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
