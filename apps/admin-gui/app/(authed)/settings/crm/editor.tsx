'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Row {
  id: string;
  org_id: string;
  provider_type: 'generic' | 'hubspot';
  name: string;
  base_url: string;
  has_api_key: boolean;
  request_template_json: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface Props {
  initialRows: Row[];
}

const TYPES: Array<{ value: 'hubspot' | 'generic'; label: string; defaultBase: string }> = [
  { value: 'hubspot', label: 'HubSpot v3', defaultBase: 'https://api.hubapi.com' },
  { value: 'generic', label: 'Generic (operator-templated)', defaultBase: '' },
];

export function CrmEditor({ initialRows }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-form state.
  const [newType, setNewType] = useState<'hubspot' | 'generic'>('hubspot');
  const [newName, setNewName] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('https://api.hubapi.com');
  const [newApiKey, setNewApiKey] = useState('');
  const [newTemplate, setNewTemplate] = useState('');

  async function add() {
    setError(null);
    if (!newName.trim()) {
      setError('name required');
      return;
    }
    if (!newBaseUrl.trim()) {
      setError('base_url required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/settings/crm-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          provider_type: newType,
          name: newName.trim(),
          base_url: newBaseUrl.trim(),
          api_key: newApiKey || null,
          request_template_json: newType === 'generic' ? newTemplate.trim() || null : null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { row: Row };
      setRows((prev) => [...prev, data.row]);
      setNewName('');
      setNewApiKey('');
      setNewTemplate('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(r: Row) {
    setError(null);
    const res = await fetch(`/api/settings/crm-providers/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ enabled: !r.enabled }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    router.refresh();
  }

  async function remove(r: Row) {
    if (!confirm(`Delete CRM provider "${r.name}"?`)) return;
    setError(null);
    const res = await fetch(`/api/settings/crm-providers/${r.id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    setRows((prev) => prev.filter((x) => x.id !== r.id));
  }

  async function rotateKey(r: Row) {
    const next = prompt(`Rotate API key for "${r.name}"? (paste new key)`);
    if (!next) return;
    const res = await fetch(`/api/settings/crm-providers/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ api_key: next }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="border border-border rounded p-4 bg-card space-y-3">
        <h2 className="text-sm font-semibold">Add provider</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-fg-subtle mb-1">
              Provider type
            </label>
            <select
              value={newType}
              onChange={(e) => {
                const v = e.target.value as 'hubspot' | 'generic';
                setNewType(v);
                const t = TYPES.find((x) => x.value === v);
                if (t?.defaultBase) setNewBaseUrl(t.defaultBase);
              }}
              className="w-full border border-border rounded bg-bg px-2 py-1 text-sm"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-subtle mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Production HubSpot"
              className="w-full border border-border rounded bg-bg px-2 py-1 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-fg-subtle mb-1">Base URL</label>
          <input
            type="text"
            value={newBaseUrl}
            onChange={(e) => setNewBaseUrl(e.target.value)}
            className="w-full border border-border rounded bg-bg px-2 py-1 text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-fg-subtle mb-1">API key</label>
          <input
            type="password"
            value={newApiKey}
            onChange={(e) => setNewApiKey(e.target.value)}
            placeholder="pat-... or token (encrypted at rest)"
            className="w-full border border-border rounded bg-bg px-2 py-1 text-sm font-mono"
          />
        </div>
        {newType === 'generic' && (
          <div>
            <label className="block text-xs text-fg-subtle mb-1">
              Request template (JSON; see docs below)
            </label>
            <textarea
              value={newTemplate}
              onChange={(e) => setNewTemplate(e.target.value)}
              rows={6}
              placeholder='{"path_template":"/v1/contacts?phone={phone}","method":"GET","field_map":{"external_id":"data.id","display_name":"data.name","email":"data.email"}}'
              className="w-full border border-border rounded bg-bg px-2 py-1 text-xs font-mono"
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy}
          className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          Add
        </button>
        {error && <p className="text-error text-xs">{error}</p>}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-fg-subtle">
          No providers configured. Add one above; agents will see
          a CRM lookup button on every live call once a provider
          is enabled.
        </p>
      ) : (
        <table className="w-full text-sm border border-border rounded">
          <thead className="bg-card">
            <tr className="text-left">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Base URL</th>
              <th className="px-3 py-2">API key</th>
              <th className="px-3 py-2">Enabled</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.provider_type}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-fg-subtle">
                  {r.base_url}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.has_api_key ? (
                    <span className="text-success">●●●●●●●●</span>
                  ) : (
                    <span className="text-warn">(not set)</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!r.enabled}
                      onChange={() => void toggleEnabled(r)}
                      className="h-4 w-4"
                    />
                    <span className={r.enabled ? 'text-success text-xs' : 'text-fg-muted text-xs'}>
                      {r.enabled ? 'live' : 'off'}
                    </span>
                  </label>
                </td>
                <td className="px-3 py-2 text-right text-xs space-x-2">
                  <button
                    type="button"
                    onClick={() => void rotateKey(r)}
                    className="text-link hover:underline"
                  >
                    Rotate key
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(r)}
                    className="text-error hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="text-xs text-fg-subtle">
        <summary className="cursor-pointer">
          Generic provider — request template format
        </summary>
        <pre className="mt-2 p-3 bg-card border border-border rounded overflow-x-auto">
{`{
  "path_template": "/v1/contacts?phone={phone}",
  "method": "GET",                                  // GET (default) or POST
  "body_template": "{\\"phone\\":\\"{phone}\\"}", // POST only
  "headers": {                                       // optional overrides
    "X-Custom-Auth": "{api_key}"
  },
  "field_map": {
    "external_id": "data.0.id",
    "display_name": "data.0.name",
    "email": "data.0.email",
    "company": "data.0.company"
  }
}`}
        </pre>
        <p className="mt-2">
          <span className="font-mono">{`{phone}`}</span> +{' '}
          <span className="font-mono">{`{api_key}`}</span> are
          the only template placeholders. Authorization defaults to{' '}
          <span className="font-mono">Bearer &lt;api_key&gt;</span>;
          override via the headers map. field_map values are dot-
          paths into the JSON response.
        </p>
      </details>
    </div>
  );
}
