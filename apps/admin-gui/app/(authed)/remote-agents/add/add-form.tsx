'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AddRemoteAgentForm({
  nodes,
  campaigns,
}: {
  nodes: Array<{ id: string; name: string; host: string }>;
  campaigns: Array<{ id: string; name: string; status: string }>;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<string>(nodes[0]?.id ?? '');
  const [extension, setExtension] = useState('');

  const selectedNode = nodes.find((n) => n.id === nodeId);
  const previewUri =
    selectedNode && extension
      ? `sip:${extension}@${selectedNode.host}`
      : null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const linesRaw = String(fd.get('lines') ?? '1');
    const campaignId = String(fd.get('campaign_id') ?? '').trim();
    const body = {
      name: String(fd.get('name') ?? '').trim(),
      telephony_node_id: nodeId,
      extension: extension.trim(),
      campaign_id: campaignId || null,
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
        label="Telephony node"
        hint="Where this endpoint lives. The SIP INVITE goes to this node's host."
      >
        <select
          value={nodeId}
          onChange={(e) => setNodeId(e.target.value)}
          required
          className="input"
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name} ({n.host})
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Extension"
        hint="The user portion of the SIP URI (e.g. 1500, or a username like agent42)."
      >
        <input
          value={extension}
          onChange={(e) => setExtension(e.target.value)}
          required
          maxLength={64}
          pattern="[a-zA-Z0-9._\-+*#@]+"
          className="input"
          placeholder="1500"
          autoComplete="off"
        />
        {previewUri && (
          <div className="mt-1 text-[11px] text-fg-subtle font-mono">
            SIP URI: <span className="text-fg">{previewUri}</span>
          </div>
        )}
      </Field>

      <Field
        label="Campaign"
        hint="Restrict this remote agent to one campaign, or leave on (any campaign) to share across all of them."
      >
        <select name="campaign_id" defaultValue="" className="input">
          <option value="">(any campaign — shared pool)</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.status}
            </option>
          ))}
        </select>
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
