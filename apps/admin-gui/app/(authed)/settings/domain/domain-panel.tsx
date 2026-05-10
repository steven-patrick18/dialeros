'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface DnsResult {
  domain?: string;
  resolved_to?: string[];
  public_ip?: string | null;
  matches?: boolean;
  hint?: string;
  error?: string;
}

interface TlsStatus {
  configured?: boolean;
  domain?: string;
  cert_exists?: boolean;
  subject?: string;
  issuer?: string;
  valid_to?: string;
  days_left?: number;
  hint?: string;
  error?: string;
}

export function DomainPanel({
  initialDomain,
  initialEmail,
}: {
  initialDomain: string;
  initialEmail: string;
}) {
  const router = useRouter();
  const [domain, setDomain] = useState(initialDomain);
  const [email, setEmail] = useState(initialEmail);
  const [savedDomain, setSavedDomain] = useState(initialDomain);
  const [busy, setBusy] = useState<'save' | 'check' | 'setup' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );
  const [dns, setDns] = useState<DnsResult | null>(null);
  const [tls, setTls] = useState<TlsStatus | null>(null);
  const [setupLog, setSetupLog] = useState<string | null>(null);
  const [setupResult, setSetupResult] = useState<{
    ok: boolean;
    error?: string;
  } | null>(null);

  // Pull TLS status on mount + after setup.
  useEffect(() => {
    refreshTls();
  }, []);

  async function refreshTls() {
    try {
      const r = await fetch('/api/settings/domain/tls-status', {
        cache: 'no-store',
      });
      const j = (await r.json().catch(() => ({}))) as TlsStatus;
      setTls(j);
    } catch {
      /* ignore */
    }
  }

  async function save() {
    setBusy('save');
    setMsg(null);
    try {
      const r = await fetch('/api/settings/domain', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: domain.trim(),
          contact_email: email.trim() || undefined,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setMsg({ tone: 'err', text: j.error ?? `failed (${r.status})` });
        return;
      }
      setSavedDomain(domain.trim());
      setMsg({ tone: 'ok', text: 'Saved.' });
      router.refresh();
      refreshTls();
    } finally {
      setBusy(null);
    }
  }

  async function checkDns() {
    if (!savedDomain) {
      setMsg({ tone: 'err', text: 'Save the domain first.' });
      return;
    }
    setBusy('check');
    setMsg(null);
    try {
      const r = await fetch('/api/settings/domain/check-dns', {
        cache: 'no-store',
      });
      const j = (await r.json().catch(() => ({}))) as DnsResult;
      setDns(j);
    } finally {
      setBusy(null);
    }
  }

  async function setupTls() {
    if (!savedDomain) {
      setMsg({ tone: 'err', text: 'Save the domain first.' });
      return;
    }
    if (
      !confirm(
        `Provision Let's Encrypt cert for ${savedDomain}? This installs nginx + certbot, requires port 80 to be free during issuance, and will switch the admin GUI to https://${savedDomain}/. Takes ~1 minute.`,
      )
    ) {
      return;
    }
    setBusy('setup');
    setSetupLog(null);
    setSetupResult(null);
    try {
      const r = await fetch('/api/settings/domain/setup-tls', {
        method: 'POST',
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        log?: string;
        error?: string;
      };
      setSetupLog(j.log ?? null);
      setSetupResult({ ok: !!j.ok, error: j.error });
      await refreshTls();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="border border-border rounded p-4">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Domain
        </h2>

        <label className="block mb-3">
          <div className="text-xs text-fg-subtle mb-1">Hostname</div>
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="dialer.example.com"
            className="input font-mono text-sm w-full"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="text-[11px] text-fg-subtle mt-1">
            Point an A record for this hostname to this server&apos;s public
            IP. Subdomain works (e.g. <span className="font-mono">dialer.example.com</span>).
          </div>
        </label>

        <label className="block mb-3">
          <div className="text-xs text-fg-subtle mb-1">
            Contact email (optional)
          </div>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
            className="input text-sm w-full"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="text-[11px] text-fg-subtle mt-1">
            Let&apos;s Encrypt sends expiry warnings to this address. Leave
            blank to use <span className="font-mono">admin@&lt;domain&gt;</span>.
          </div>
        </label>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy !== null || !domain.trim()}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-40"
          >
            {busy === 'save' ? 'Saving…' : 'Save domain'}
          </button>
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

      <div className="border border-border rounded p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted">
            DNS check
          </h2>
          <button
            type="button"
            onClick={checkDns}
            disabled={busy !== null || !savedDomain}
            className="text-xs text-fg-muted hover:text-fg disabled:opacity-50"
          >
            {busy === 'check' ? 'Checking…' : 'Check now'}
          </button>
        </div>
        {!savedDomain ? (
          <p className="text-fg-subtle text-sm">
            Save a domain above to check it.
          </p>
        ) : !dns ? (
          <p className="text-fg-subtle text-sm">
            Hit &ldquo;Check now&rdquo; once you&apos;ve set the A record.
          </p>
        ) : (
          <div className="text-sm space-y-1">
            <div>
              <span className="text-fg-subtle">Domain:</span>{' '}
              <span className="font-mono">{dns.domain}</span>
            </div>
            <div>
              <span className="text-fg-subtle">Resolved to:</span>{' '}
              <span className="font-mono">
                {dns.resolved_to?.length
                  ? dns.resolved_to.join(', ')
                  : '(no A record)'}
              </span>
            </div>
            <div>
              <span className="text-fg-subtle">This server:</span>{' '}
              <span className="font-mono">{dns.public_ip ?? 'unknown'}</span>
            </div>
            <div
              className={`mt-2 rounded border p-2 text-xs ${
                dns.matches
                  ? 'border-success/40 bg-success/10 text-success'
                  : 'border-warn/40 bg-warn/10 text-warn'
              }`}
            >
              {dns.hint}
            </div>
          </div>
        )}
      </div>

      <div className="border border-border rounded p-4">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          TLS / Let&apos;s Encrypt
        </h2>
        <div className="text-sm mb-3">
          {!savedDomain ? (
            <span className="text-fg-subtle">Save a domain first.</span>
          ) : tls?.cert_exists ? (
            <div className="space-y-1">
              <div className="text-success">
                ✓ Cert installed for{' '}
                <span className="font-mono">{tls.domain}</span>
              </div>
              {tls.valid_to && (
                <div className="text-xs text-fg-subtle">
                  Expires {new Date(tls.valid_to).toLocaleString()}
                  {typeof tls.days_left === 'number' && (
                    <> &mdash; {tls.days_left} days left</>
                  )}
                </div>
              )}
              <div className="text-xs text-fg-subtle">
                Admin GUI:{' '}
                <a
                  href={`https://${tls.domain}/`}
                  className="text-accent hover:underline font-mono"
                  target="_blank"
                  rel="noreferrer"
                >
                  https://{tls.domain}/
                </a>
              </div>
              <div className="text-xs text-fg-subtle">
                Softphone WSS:{' '}
                <span className="font-mono">wss://{tls.domain}/sip</span>
              </div>
            </div>
          ) : (
            <span className="text-fg-subtle">{tls?.hint ?? 'No cert yet.'}</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={setupTls}
            disabled={busy !== null || !savedDomain}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-40"
          >
            {busy === 'setup'
              ? 'Setting up… (this can take a minute)'
              : tls?.cert_exists
                ? 'Re-run TLS setup'
                : 'Set up TLS'}
          </button>
          {!dns?.matches && dns && (
            <span className="text-xs text-warn">
              DNS doesn&apos;t resolve here yet &mdash; cert issuance will fail.
            </span>
          )}
        </div>

        {setupResult && (
          <div
            className={`mt-3 rounded border p-3 text-sm ${
              setupResult.ok
                ? 'border-success/50 bg-success/10 text-success'
                : 'border-error/50 bg-error/10 text-error'
            }`}
          >
            {setupResult.ok
              ? `Done. Open https://${savedDomain}/ to switch over.`
              : `Failed: ${setupResult.error ?? 'see log'}`}
          </div>
        )}

        {setupLog && (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-fg-subtle hover:text-fg-muted">
              Setup log ({setupLog.length} chars)
            </summary>
            <pre className="mt-2 max-h-72 overflow-y-auto bg-card/70 border border-border rounded p-2 font-mono text-[11px] whitespace-pre-wrap">
              {setupLog}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
