'use client';

import { useState } from 'react';

export function SmtpForm({
  initial,
}: {
  initial: {
    host: string;
    port: number;
    user: string;
    from: string;
    starttls: boolean;
    password_set: boolean;
  };
}) {
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(initial.port);
  const [user, setUser] = useState(initial.user);
  const [password, setPassword] = useState('');
  const [from, setFrom] = useState(initial.from);
  const [starttls, setStarttls] = useState(initial.starttls);
  const [passwordSet, setPasswordSet] = useState(initial.password_set);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: boolean; message: string } | null
  >(null);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const body: Record<string, unknown> = {
        host,
        port: Number(port),
        user,
        from,
        starttls,
      };
      // password: only send if the user typed something. Empty
      // string means "no change", not "clear" — clear via API
      // PUT with explicit "" later if/when we add a wipe button.
      if (password.length > 0) body.password = password;
      const res = await fetch('/api/settings/smtp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { password_set: boolean };
      setPassword('');
      setPasswordSet(data.password_set);
      setSuccess(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/smtp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ to: testTo }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && data.ok) {
        setTestResult({
          ok: true,
          message: `Test email sent to ${testTo}. Check the inbox + the /var/log/msmtp.log on the VPS for delivery confirmation.`,
        });
      } else {
        setTestResult({
          ok: false,
          message: data.error ?? `HTTP ${res.status}`,
        });
      }
    } catch (e) {
      setTestResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="border border-border rounded p-4 bg-card space-y-3">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted">
          Relay
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm flex flex-col gap-1">
            <span className="text-fg-subtle">Host</span>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="input"
              placeholder="smtp.sendgrid.net"
            />
          </label>
          <label className="text-sm flex flex-col gap-1">
            <span className="text-fg-subtle">Port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className="input"
            />
          </label>
          <label className="text-sm flex flex-col gap-1">
            <span className="text-fg-subtle">Username</span>
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              className="input"
              placeholder="apikey  (SendGrid) / IAM user (SES) / etc."
            />
          </label>
          <label className="text-sm flex flex-col gap-1">
            <span className="text-fg-subtle">
              Password{' '}
              {passwordSet ? (
                <span className="text-success text-xs">(set)</span>
              ) : (
                <span className="text-warn text-xs">(not set)</span>
              )}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder={
                passwordSet
                  ? 'Leave blank to keep current'
                  : 'Required'
              }
            />
          </label>
          <label className="text-sm flex flex-col gap-1 md:col-span-2">
            <span className="text-fg-subtle">From address</span>
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="input"
              placeholder="noreply@yourcompany.com"
            />
          </label>
          <label className="text-sm flex items-center gap-2 md:col-span-2">
            <input
              type="checkbox"
              checked={starttls}
              onChange={(e) => setStarttls(e.target.checked)}
            />
            <span>
              Use STARTTLS{' '}
              <span className="text-fg-subtle">
                (standard for port 587; disable for port 25
                plaintext only — never recommended)
              </span>
            </span>
          </label>
        </div>
        {success ? <p className="text-success text-sm">Saved.</p> : null}
        {error ? <p className="text-error text-sm">{error}</p> : null}
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="border border-border rounded p-4 bg-card space-y-3">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted">
          Send test email
        </h2>
        <p className="text-xs text-fg-subtle">
          Sends a one-line email through the configured relay to
          verify the auth + TLS path. Uses{' '}
          <code>/usr/sbin/sendmail</code> on the VPS, which is the
          msmtp-mta symlink installed by install-smtp.sh.
        </p>
        <div className="flex gap-2 items-end">
          <label className="text-sm flex flex-col gap-1 flex-1">
            <span className="text-fg-subtle">Send to</span>
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              className="input"
              placeholder="ops@yourcompany.com"
            />
          </label>
          <button
            type="button"
            onClick={sendTest}
            disabled={testing || !testTo || !passwordSet}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-2 rounded text-sm disabled:opacity-50"
          >
            {testing ? 'Sending…' : 'Send test'}
          </button>
        </div>
        {testResult ? (
          <p
            className={`text-sm ${testResult.ok ? 'text-success' : 'text-error'}`}
          >
            {testResult.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
