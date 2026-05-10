'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AddRemoteAgentForm({
  nodes,
}: {
  nodes: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const linesRaw = String(fd.get('lines') ?? '1');
    const body = {
      name: String(fd.get('name') ?? '').trim(),
      sip_uri: String(fd.get('sip_uri') ?? '').trim(),
      telephony_node_id:
        String(fd.get('telephony_node_id') ?? '').trim() || undefined,
      lines: Math.max(1, parseInt(linesRaw, 10) || 1),
      enabled: fd.get('enabled') === 'on',
    };

    const res = await fetch('/api/remote-agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `Failed (${res.status})`);
      setSubmitting(false);
      return;
    }
    const { id } = (await res.json()) as { id: string };
    router.push(`/remote-agents/${id}`);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <Field
        label="Name"
        hint="Internal identifier. Alphanumeric, dashes/underscores. Unique."
      >
        <input
          name="name"
          required
          pattern="[a-zA-Z0-9_-]+"
          maxLength={64}
          className="input"
          placeholder="kolkata-desk-3"
          autoComplete="off"
        />
      </Field>

      <Field
        label="SIP URI"
        hint="Where the pacer will send the INVITE. Format: sip:user@host[:port]."
      >
        <input
          name="sip_uri"
          required
          className="input"
          placeholder="sip:1500@10.0.0.5"
          autoComplete="off"
        />
      </Field>

      <Field
        label="Lines"
        hint="Maximum concurrent calls this remote agent can handle. Counted into the pacer's dial-level math."
      >
        <input
          name="lines"
          type="number"
          min={1}
          max={64}
          defaultValue={1}
          required
          className="input w-32 tabular-nums"
        />
      </Field>

      {nodes.length > 0 && (
        <Field
          label="Telephony node (optional)"
          hint="Bind this remote agent to a specific telephony node so the pacer originates locally to it when possible. Leave blank for any node."
        >
          <select name="telephony_node_id" className="input" defaultValue="">
            <option value="">(any node)</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <label className="inline-flex items-center gap-2">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked
          className="h-4 w-4"
        />
        <span className="text-sm">Enabled</span>
      </label>

      {error && (
        <div className="border border-error/50 bg-error/10 text-error text-sm rounded p-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg px-4 py-2 rounded text-sm"
      >
        {submitting ? 'Creating…' : 'Create remote agent'}
      </button>
    </form>
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
