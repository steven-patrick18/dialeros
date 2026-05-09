'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const TRANSPORTS = ['UDP', 'TCP', 'TLS'] as const;
const AUTH_MODES = ['digest', 'ip-acl'] as const;
const CODECS = ['PCMU', 'PCMA', 'OPUS', 'G729'] as const;

type Transport = (typeof TRANSPORTS)[number];
type AuthMode = (typeof AUTH_MODES)[number];
type Codec = (typeof CODECS)[number];

const AUTH_MODE_HINTS: Record<AuthMode, string> = {
  digest: 'Username + password sent on every INVITE.',
  'ip-acl': 'Allow only requests from listed source IPs (no credentials).',
};

export function AddCarrierForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('digest');
  const [codecs, setCodecs] = useState<Set<Codec>>(
    new Set(['PCMU', 'PCMA']),
  );

  function toggleCodec(c: Codec) {
    const next = new Set(codecs);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setCodecs(next);
  }

  // Preserve UI declaration order as preference order.
  const orderedCodecs = CODECS.filter((c) => codecs.has(c));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    if (orderedCodecs.length === 0) {
      setError('Select at least one codec.');
      setSubmitting(false);
      return;
    }

    const fd = new FormData(e.currentTarget);
    const body = {
      name: String(fd.get('name') ?? ''),
      host: String(fd.get('host') ?? ''),
      port: Number(fd.get('port') ?? 5060),
      transport: String(fd.get('transport') ?? 'UDP') as Transport,
      auth_mode: authMode,
      digest_username:
        authMode === 'digest'
          ? String(fd.get('digest_username') ?? '')
          : undefined,
      digest_password:
        authMode === 'digest'
          ? String(fd.get('digest_password') ?? '')
          : undefined,
      ip_acl:
        authMode === 'ip-acl' ? String(fd.get('ip_acl') ?? '') : undefined,
      codecs: orderedCodecs,
      max_channels: Number(fd.get('max_channels') ?? 100),
      max_cps: Number(fd.get('max_cps') ?? 10),
      mos_threshold: Number(fd.get('mos_threshold') ?? 3.5),
      enabled: fd.get('enabled') === 'on',
    };

    const res = await fetch('/api/carriers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Failed (${res.status})`);
      setSubmitting(false);
      return;
    }

    const { id } = (await res.json()) as { id: string };
    router.push(`/carriers/${id}`);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <Section title="Identity">
        <Field label="Friendly Name" hint="Alphanumeric, dashes, underscores. Used in route plans.">
          <input
            name="name"
            required
            className="input"
            placeholder="twilio-us-east"
            autoComplete="off"
          />
        </Field>
      </Section>

      <Section title="Connection">
        <Field label="Host" hint="IP address or DNS name of the carrier endpoint.">
          <input
            name="host"
            required
            className="input"
            placeholder="sip.twilio.com"
            autoComplete="off"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Port">
            <input
              name="port"
              type="number"
              defaultValue={5060}
              min={1}
              max={65535}
              className="input"
            />
          </Field>
          <Field label="Transport">
            <select name="transport" defaultValue="UDP" className="input">
              {TRANSPORTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Authentication">
        <Field label="Mode" hint={AUTH_MODE_HINTS[authMode]}>
          <select
            value={authMode}
            onChange={(e) => setAuthMode(e.target.value as AuthMode)}
            className="input"
          >
            {AUTH_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>

        {authMode === 'digest' && (
          <>
            <Field label="Digest Username">
              <input
                name="digest_username"
                required
                className="input"
                autoComplete="off"
              />
            </Field>
            <Field
              label="Digest Password"
              hint="Encrypted at rest with the cluster master key."
            >
              <input
                name="digest_password"
                type="password"
                required
                className="input"
                autoComplete="new-password"
              />
            </Field>
          </>
        )}

        {authMode === 'ip-acl' && (
          <Field
            label="Allowed Source IPs"
            hint="Comma-separated. IPs or CIDR blocks (10.0.0.5, 192.168.1.0/24)."
          >
            <input
              name="ip_acl"
              required
              className="input"
              placeholder="10.0.0.5, 10.0.0.6"
              autoComplete="off"
            />
          </Field>
        )}
      </Section>

      <Section title="Codecs">
        <p className="text-xs text-fg-subtle -mt-1 mb-2">
          Preference order = the order shown below. Uncheck to disable.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {CODECS.map((c) => (
            <label
              key={c}
              className="flex items-center gap-2 px-3 py-2 border border-border rounded text-sm cursor-pointer hover:bg-card-hover"
            >
              <input
                type="checkbox"
                checked={codecs.has(c)}
                onChange={() => toggleCodec(c)}
              />
              <span className="font-mono">{c}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Capacity & Quality">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Max channels">
            <input
              name="max_channels"
              type="number"
              defaultValue={100}
              min={1}
              max={10000}
              className="input"
            />
          </Field>
          <Field label="Max CPS" hint="Calls per second.">
            <input
              name="max_cps"
              type="number"
              defaultValue={10}
              min={1}
              max={1000}
              className="input"
            />
          </Field>
          <Field label="MOS threshold" hint="Auto-disable below.">
            <input
              name="mos_threshold"
              type="number"
              step="0.1"
              defaultValue={3.5}
              min={0}
              max={5}
              className="input"
            />
          </Field>
        </div>
      </Section>

      <label className="flex items-center gap-2 text-sm">
        <input name="enabled" type="checkbox" defaultChecked />
        <span>Enabled</span>
      </label>

      {error && (
        <div className="border border-error/50 bg-error/10 text-error text-sm rounded p-3">
          {error}
        </div>
      )}

      <div className="pt-2 flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg px-4 py-2 rounded text-sm"
        >
          {submitting ? 'Savingâ€¦' : 'Add carrier'}
        </button>
        <Link
          href="/carriers"
          className="px-4 py-2 rounded text-sm hover:bg-card-hover text-fg-muted"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 border border-border rounded p-4">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted">{title}</h2>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-sm font-medium mb-1">{label}</div>
      {hint && <div className="text-xs text-fg-subtle mb-1">{hint}</div>}
      {children}
    </label>
  );
}
