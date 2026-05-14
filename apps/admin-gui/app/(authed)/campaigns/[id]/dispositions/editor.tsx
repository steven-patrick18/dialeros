'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Row {
  code: string;
  label: string;
  lead_status_target: string;
  is_callback: boolean;
  ordering: number;
  is_active: boolean;
}

export function PaletteEditor({
  campaignId,
  initial,
  leadStatusOptions,
}: {
  campaignId: string;
  initial: Array<{
    code: string;
    label: string;
    lead_status_target: string;
    is_callback: number;
    ordering: number;
    is_active: number;
  }>;
  leadStatusOptions: string[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(
    initial.map((r, i) => ({
      code: r.code,
      label: r.label,
      lead_status_target: r.lead_status_target,
      is_callback: r.is_callback === 1,
      ordering: r.ordering ?? i,
      is_active: r.is_active === 1,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function addRow() {
    setRows((rs) => [
      ...rs,
      {
        code: '',
        label: '',
        lead_status_target: 'DEAD',
        is_callback: false,
        ordering: rs.length,
        is_active: true,
      },
    ]);
  }

  function remove(idx: number) {
    setRows((rs) => rs.filter((_, i) => i !== idx));
  }

  function setField<K extends keyof Row>(
    idx: number,
    key: K,
    val: Row[K],
  ) {
    setRows((rs) =>
      rs.map((r, i) => (i === idx ? { ...r, [key]: val } : r)),
    );
  }

  function move(idx: number, dir: -1 | 1) {
    setRows((rs) => {
      const target = idx + dir;
      if (target < 0 || target >= rs.length) return rs;
      const next = [...rs];
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return next.map((r, i) => ({ ...r, ordering: i }));
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/dispositions`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            palette: rows.map((r, i) => ({
              code: r.code.trim().toUpperCase(),
              label: r.label.trim(),
              lead_status_target: r.lead_status_target,
              is_callback: r.is_callback,
              ordering: i,
              is_active: r.is_active,
            })),
          }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          details?: unknown;
        };
        setError(
          data.error
            ? `${data.error}${data.details ? ' — ' + JSON.stringify(data.details) : ''}`
            : `HTTP ${res.status}`,
        );
        return;
      }
      setSuccess(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-fg-subtle text-sm">
          No custom dispositions. Add one to start, or leave empty
          to use the hardcoded fallback (SALE / CALLBACK /
          NO_INTEREST / WRONG_NUMBER / BAD_NUMBER / DNC /
          ANSWERING_MACHINE / VOICEMAIL_DROPPED / SURVEYED).
        </p>
      ) : (
        <table className="w-full text-sm border border-border rounded">
          <thead className="bg-bg-elevated text-fg-subtle text-left text-xs uppercase tracking-wide">
            <tr>
              <th className="px-2 py-1.5 w-32">Code</th>
              <th className="px-2 py-1.5">Label</th>
              <th className="px-2 py-1.5 w-40">Lead status</th>
              <th className="px-2 py-1.5 w-20">Callback</th>
              <th className="px-2 py-1.5 w-16">Active</th>
              <th className="px-2 py-1.5 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-2 py-1.5">
                  <input
                    value={r.code}
                    onChange={(e) =>
                      setField(i, 'code', e.target.value.toUpperCase())
                    }
                    className="input font-mono text-xs"
                    placeholder="SALE"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={r.label}
                    onChange={(e) => setField(i, 'label', e.target.value)}
                    className="input"
                    placeholder="Successful sale"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={r.lead_status_target}
                    onChange={(e) =>
                      setField(i, 'lead_status_target', e.target.value)
                    }
                    className="input"
                  >
                    {leadStatusOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={r.is_callback}
                    onChange={(e) =>
                      setField(i, 'is_callback', e.target.checked)
                    }
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={r.is_active}
                    onChange={(e) =>
                      setField(i, 'is_active', e.target.checked)
                    }
                  />
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="text-fg-subtle hover:text-fg disabled:opacity-30 px-1"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === rows.length - 1}
                      className="text-fg-subtle hover:text-fg disabled:opacity-30 px-1"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="text-error hover:text-error-strong px-1"
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button
        type="button"
        onClick={addRow}
        className="text-sm bg-card-hover hover:bg-card-hover/70 px-3 py-1.5 rounded"
      >
        + Add disposition
      </button>

      {success ? (
        <p className="text-success text-sm">Saved.</p>
      ) : null}
      {error ? <p className="text-error text-sm">{error}</p> : null}

      <div className="pt-2 border-t border-border flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save palette'}
        </button>
        <p className="text-xs text-fg-subtle">
          Saving replaces the entire palette atomically. Agents
          mid-wrap-up keep using whichever palette was active when
          they opened the dialog.
        </p>
      </div>
    </div>
  );
}
