'use client';

import { useCallback, useEffect, useState } from 'react';

interface Mem {
  id: string;
  scope_type: string;
  scope_id: string;
  kind: string;
  title: string;
  content: string;
  source: string;
  enabled: number;
  embedded: boolean;
  created_at: string;
}
interface ScopeOpt {
  id: string;
  name: string;
}

export function MemoryManager({
  campaigns,
  inGroups,
}: {
  campaigns: ScopeOpt[];
  inGroups: ScopeOpt[];
}) {
  const [rows, setRows] = useState<Mem[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [scopeType, setScopeType] = useState('global');
  const [scopeId, setScopeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [packFile, setPackFile] = useState<File | null>(null);
  const [collapse, setCollapse] = useState('keep');
  const [packMsg, setPackMsg] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/ai/memory', { credentials: 'same-origin' });
    if (r.ok) setRows(((await r.json()) as { rows: Mem[] }).rows);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!title.trim() || !content.trim()) {
      setMsg('Title + content required');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/ai/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          scope_type: scopeType,
          scope_id: scopeType === 'global' ? '' : scopeId,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        chunks?: number;
        embed_warning?: string | null;
      };
      if (!r.ok) {
        setMsg(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setMsg(
        `Stored ${j.chunks} chunk(s).` +
          (j.embed_warning ? ` ⚠ embed: ${j.embed_warning}` : ''),
      );
      setTitle('');
      setContent('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(m: Mem) {
    await fetch(`/api/ai/memory/${m.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ enabled: !m.enabled }),
    });
    await load();
  }
  async function del(m: Mem) {
    if (!confirm(`Delete memory "${m.title}"?`)) return;
    await fetch(`/api/ai/memory/${m.id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    await load();
  }

  function exportBrain() {
    window.location.assign('/api/ai/memory/pack');
  }
  async function runImport(dry: boolean) {
    if (!packFile) {
      setPackMsg('Choose a pack file first');
      return;
    }
    setPackBusy(true);
    setPackMsg(null);
    try {
      const text = await packFile.text();
      const r = await fetch('/api/ai/memory/pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          pack: text,
          scope_remap:
            collapse === 'global' ? { '*': 'global' } : null,
          dry_run: dry,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        imported?: number;
        skipped?: number;
        total?: number;
        dry_run?: boolean;
      };
      if (!r.ok) {
        setPackMsg(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setPackMsg(
        `${j.dry_run ? 'Preview — would import' : 'Imported'} ` +
          `${j.imported}, skipped ${j.skipped} dupe(s) of ` +
          `${j.total}.`,
      );
      if (!j.dry_run) await load();
    } finally {
      setPackBusy(false);
    }
  }

  function scopeLabel(m: Mem): string {
    if (m.scope_type === 'global') return 'global';
    const list = m.scope_type === 'campaign' ? campaigns : inGroups;
    const n = list.find((x) => x.id === m.scope_id)?.name;
    return `${m.scope_type}:${n ?? m.scope_id}`;
  }

  return (
    <div className="border border-border rounded p-4 bg-card mt-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Master memory (RAG)</h2>
        <p className="text-xs text-fg-subtle mt-0.5">
          Knowledge the Master injects into Worker prompts at call
          time (iter 204 wires retrieval). Scope it global, or to
          a campaign / in-group. Long text is auto-chunked +
          embedded locally (all-minilm).
        </p>
      </div>
      <div className="space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (e.g. Pricing policy)"
          className="w-full border border-border rounded bg-bg px-2 py-1 text-sm"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          placeholder="Knowledge content the AI should know + apply…"
          className="w-full border border-border rounded bg-bg px-2 py-1 text-xs"
        />
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-fg-subtle mb-1">Scope</label>
            <select
              value={scopeType}
              onChange={(e) => {
                setScopeType(e.target.value);
                setScopeId('');
              }}
              className="border border-border rounded bg-bg px-2 py-1 text-sm"
            >
              <option value="global">Global (all AI calls)</option>
              <option value="campaign">Campaign</option>
              <option value="in_group">In-group</option>
            </select>
          </div>
          {scopeType !== 'global' && (
            <div>
              <label className="block text-xs text-fg-subtle mb-1">
                {scopeType === 'campaign' ? 'Campaign' : 'In-group'}
              </label>
              <select
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className="border border-border rounded bg-bg px-2 py-1 text-sm"
              >
                <option value="">— select —</option>
                {(scopeType === 'campaign' ? campaigns : inGroups).map(
                  (o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ),
                )}
              </select>
            </div>
          )}
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy}
            className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            {busy ? 'Embedding…' : 'Add to memory'}
          </button>
        </div>
        {msg && <p className="text-xs text-fg-subtle">{msg}</p>}
      </div>

      <div className="border border-border rounded p-3 bg-bg space-y-2">
        <div>
          <h3 className="text-xs font-semibold">
            Portable brain (export / stack)
          </h3>
          <p className="text-[11px] text-fg-subtle mt-0.5">
            Export this cluster's learned memory as one
            pack file, or stack a pack from another
            cluster. Re-importing is idempotent (dupes
            skipped). Vectors only match within the same
            local embed model.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            onClick={exportBrain}
            className="bg-card border border-border px-3 py-1.5 rounded text-sm"
          >
            Export brain
          </button>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) =>
              setPackFile(e.target.files?.[0] ?? null)
            }
            className="text-xs"
          />
          <div>
            <label className="block text-[11px] text-fg-subtle mb-1">
              Import scope
            </label>
            <select
              value={collapse}
              onChange={(e) => setCollapse(e.target.value)}
              className="border border-border rounded bg-bg px-2 py-1 text-sm"
            >
              <option value="keep">Keep original scope</option>
              <option value="global">Collapse all → global</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => void runImport(true)}
            disabled={packBusy}
            className="bg-card border border-border px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => void runImport(false)}
            disabled={packBusy}
            className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            {packBusy ? "Working…" : "Import + stack"}
          </button>
        </div>
        {packMsg && (
          <p className="text-xs text-fg-subtle">{packMsg}</p>
        )}
      </div>

      {rows.length > 0 && (
        <table className="w-full text-xs border border-border rounded">
          <thead className="bg-bg">
            <tr className="text-left">
              <th className="px-2 py-1">Title</th>
              <th className="px-2 py-1">Scope</th>
              <th className="px-2 py-1">Kind</th>
              <th className="px-2 py-1">Embed</th>
              <th className="px-2 py-1">On</th>
              <th className="px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-t border-border">
                <td className="px-2 py-1">{m.title}</td>
                <td className="px-2 py-1 font-mono">{scopeLabel(m)}</td>
                <td className="px-2 py-1">{m.kind}</td>
                <td className="px-2 py-1">
                  {m.embedded ? (
                    <span className="text-success">●</span>
                  ) : (
                    <span className="text-warn" title="not embedded (model offline at add time)">
                      ○
                    </span>
                  )}
                </td>
                <td className="px-2 py-1">
                  <input
                    type="checkbox"
                    checked={!!m.enabled}
                    onChange={() => void toggle(m)}
                    className="h-3 w-3"
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  <button
                    type="button"
                    onClick={() => void del(m)}
                    className="text-error hover:underline"
                  >
                    del
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
