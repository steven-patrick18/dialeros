'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  enabled: number;
  settings_json: string | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  initialRows: OrgRow[];
  userCounts: Record<string, number>;
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function OrgsEditor({ initialRows, userCounts }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<OrgRow[]>(initialRows);
  const [newId, setNewId] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    if (!ID_RE.test(newId.trim())) {
      setError('id must be lowercase alphanumeric + _-');
      return;
    }
    if (!SLUG_RE.test(newSlug.trim())) {
      setError('slug must be lowercase alphanumeric + _-, max 32');
      return;
    }
    if (!newName.trim()) {
      setError('name required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          id: newId.trim(),
          slug: newSlug.trim(),
          name: newName.trim(),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { row: OrgRow };
      setRows((prev) => [...prev, data.row].sort((a, b) =>
        a.name.localeCompare(b.name),
      ));
      setNewId('');
      setNewSlug('');
      setNewName('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function rename(r: OrgRow) {
    const next = prompt(`New name for ${r.slug}?`, r.name);
    if (!next || next === r.name) return;
    const res = await fetch(`/api/orgs/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ name: next }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    setRows((prev) =>
      prev.map((x) => (x.id === r.id ? { ...x, name: next } : x)),
    );
  }

  async function toggleEnabled(r: OrgRow) {
    const res = await fetch(`/api/orgs/${r.id}`, {
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
    setRows((prev) =>
      prev.map((x) =>
        x.id === r.id ? { ...x, enabled: x.enabled ? 0 : 1 } : x,
      ),
    );
  }

  async function remove(r: OrgRow) {
    if (!confirm(`Delete org ${r.name}?`)) return;
    const res = await fetch(`/api/orgs/${r.id}`, {
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

  return (
    <div className="space-y-4">
      <div className="border border-border rounded p-4 bg-card">
        <h2 className="text-sm font-semibold mb-3">Add organization</h2>
        <div className="grid grid-cols-3 gap-3 mb-2">
          <div>
            <label className="block text-xs text-fg-subtle mb-1">ID</label>
            <input
              type="text"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="acme"
              className="w-full border border-border rounded bg-bg px-2 py-1 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-fg-subtle mb-1">Slug</label>
            <input
              type="text"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="acme"
              className="w-full border border-border rounded bg-bg px-2 py-1 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-fg-subtle mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Acme Corp"
              className="w-full border border-border rounded bg-bg px-2 py-1 text-sm"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy}
          className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          Add
        </button>
        {error ? <p className="text-error text-xs mt-2">{error}</p> : null}
      </div>

      <table className="w-full text-sm border border-border rounded">
        <thead className="bg-card">
          <tr className="text-left">
            <th className="px-3 py-2">ID</th>
            <th className="px-3 py-2">Slug</th>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Users</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.slug}</td>
              <td className="px-3 py-2">{r.name}</td>
              <td className="px-3 py-2 tabular-nums">
                {userCounts[r.id] ?? 0}
              </td>
              <td className="px-3 py-2">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!r.enabled}
                    onChange={() => void toggleEnabled(r)}
                    disabled={r.id === 'default'}
                    className="h-4 w-4"
                  />
                  <span className={r.enabled ? 'text-success text-xs' : 'text-fg-muted text-xs'}>
                    {r.enabled ? 'enabled' : 'disabled'}
                  </span>
                </label>
              </td>
              <td className="px-3 py-2 text-right text-xs space-x-2">
                <button
                  type="button"
                  onClick={() => void rename(r)}
                  className="text-link hover:underline"
                >
                  Rename
                </button>
                {r.id !== 'default' && (userCounts[r.id] ?? 0) === 0 ? (
                  <button
                    type="button"
                    onClick={() => void remove(r)}
                    className="text-error hover:underline"
                  >
                    Delete
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
