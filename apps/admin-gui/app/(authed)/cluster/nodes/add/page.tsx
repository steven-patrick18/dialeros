'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const ROLES = ['telephony', 'web', 'database', 'ai-worker'] as const;

const ROLE_DESCRIPTIONS: Record<(typeof ROLES)[number], string> = {
  telephony: 'Kamailio + FreeSWITCH. ~500 concurrent calls per node.',
  web: 'Agent UI, supervisor cockpit, REST API. Stateless behind LB.',
  database: 'PostgreSQL primary. One per cluster, read replicas optional.',
  'ai-worker': 'AI agent runtime (whisper.cpp + llama + Piper).',
};

export default function AddNode() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<(typeof ROLES)[number]>('web');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const body = {
      name: String(fd.get('name') ?? ''),
      host: String(fd.get('host') ?? ''),
      port: Number(fd.get('port') ?? 22),
      ssh_user: String(fd.get('ssh_user') ?? 'root'),
      ssh_password: String(fd.get('ssh_password') ?? ''),
      role: String(fd.get('role') ?? ''),
    };

    const res = await fetch('/api/nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Provisioning failed (${res.status})`);
      setSubmitting(false);
      return;
    }

    const { id } = (await res.json()) as { id: string };
    router.push(`/cluster/nodes/${id}`);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">Add Node to Cluster</h1>
      <p className="text-fg-muted mb-6 text-sm max-w-xl">
        Provide SSH credentials. The node will be hardened, base packages
        installed, and role-specific software provisioned. SSH password is used
        once for bootstrap, then key-based auth takes over.
      </p>

      <form onSubmit={onSubmit} className="max-w-xl space-y-4">
        <Field label="Friendly Name" hint="Used as hostname. Alphanumeric, dashes, underscores.">
          <input
            name="name"
            required
            className="input"
            placeholder="telephony-01"
            autoComplete="off"
          />
        </Field>

        <Field label="Host" hint="IP address or DNS name reachable from this master.">
          <input
            name="host"
            required
            className="input"
            placeholder="10.0.0.5"
            autoComplete="off"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="SSH Port">
            <input name="port" type="number" defaultValue={22} className="input" />
          </Field>
          <Field label="SSH User">
            <input
              name="ssh_user"
              defaultValue="root"
              className="input"
              autoComplete="off"
            />
          </Field>
        </div>

        <Field label="SSH Password">
          <input
            name="ssh_password"
            type="password"
            required
            className="input"
            autoComplete="new-password"
          />
        </Field>

        <Field label="Role" hint={ROLE_DESCRIPTIONS[role]}>
          <select
            name="role"
            required
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>

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
            {submitting ? 'Provisioningâ€¦' : 'Provision Node'}
          </button>
          <Link
            href="/cluster/nodes"
            className="px-4 py-2 rounded text-sm hover:bg-card-hover text-fg-muted"
          >
            Cancel
          </Link>
        </div>
      </form>
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
