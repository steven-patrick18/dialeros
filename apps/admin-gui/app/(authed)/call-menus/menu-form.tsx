'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Iter 149 — Shared call-menu form. Used by both /call-menus/add
// and /call-menus/[id] (the edit page passes initial data). All
// fields including the options grid are managed client-side; the
// PUT/POST sends one big payload that the server validates with
// CallMenuInputSchema in one round trip.
//
// The options grid is a small reactive table — each row has digit,
// label, action_type, action_value. Click "Add option" to grow,
// "✕" to remove. Saving the form replaces the entire option list
// server-side (delete-and-insert in one transaction).

interface OptionRow {
  digit: string;
  label: string;
  action_type: string;
  action_value: string;
  ordering: number;
}

interface FormData {
  name: string;
  description: string;
  prompt_tts_text: string;
  prompt_path: string;
  timeout_seconds: number;
  max_retries: number;
  invalid_audio_path: string;
  timeout_audio_path: string;
  default_action_type: string;
  default_action_value: string;
  options: OptionRow[];
}

const EMPTY_FORM: FormData = {
  name: '',
  description: '',
  prompt_tts_text: '',
  prompt_path: '',
  timeout_seconds: 5,
  max_retries: 3,
  invalid_audio_path: '',
  timeout_audio_path: '',
  default_action_type: 'hangup',
  default_action_value: '',
  options: [],
};

const ACTION_TYPES = [
  { value: 'hangup', label: 'Hang up' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'in_group', label: 'In-Group' },
  { value: 'extension', label: 'Extension' },
  { value: 'call_menu', label: 'Sub-menu' },
  { value: 'did', label: 'DID (transfer out)' },
] as const;

export function CallMenuForm({
  initialData,
  menuId,
}: {
  initialData?: FormData;
  menuId?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormData>(initialData ?? EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField<K extends keyof FormData>(key: K, val: FormData[K]) {
    setForm((s) => ({ ...s, [key]: val }));
  }

  function setOption(idx: number, key: keyof OptionRow, val: string | number) {
    setForm((s) => ({
      ...s,
      options: s.options.map((o, i) =>
        i === idx ? { ...o, [key]: val } : o,
      ),
    }));
  }

  function addOption() {
    setForm((s) => {
      // Find the next unused digit, starting from 1.
      const used = new Set(s.options.map((o) => o.digit));
      const candidates = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'];
      const digit = candidates.find((d) => !used.has(d)) ?? '0';
      return {
        ...s,
        options: [
          ...s.options,
          {
            digit,
            label: '',
            action_type: 'hangup',
            action_value: '',
            ordering: s.options.length,
          },
        ],
      };
    });
  }

  function removeOption(idx: number) {
    setForm((s) => ({
      ...s,
      options: s.options.filter((_, i) => i !== idx),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const url = menuId
        ? `/api/call-menus/${menuId}`
        : `/api/call-menus`;
      const method = menuId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        credentials: 'same-origin',
      });
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
      router.push('/call-menus');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!menuId) return;
    if (
      !confirm(
        'Delete this call menu? Connected DIDs / in-groups / campaigns will be un-wired (iter 151 will handle gracefully).',
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/call-menus/${menuId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setError(`Delete failed — HTTP ${res.status}`);
        return;
      }
      router.push('/call-menus');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Name</span>
          <input
            required
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            className="input"
            placeholder="main-ivr"
          />
        </label>
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Description</span>
          <input
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            className="input"
            placeholder="Main inbound menu (sales/support)"
          />
        </label>
      </div>

      <fieldset className="border border-border rounded p-4">
        <legend className="text-xs uppercase tracking-wide text-fg-subtle px-2">
          Prompt
        </legend>
        <label className="text-sm flex flex-col gap-1 mb-3">
          <span className="text-fg-subtle">
            Prompt TTS text (iter 149 — audio upload arrives in iter 150)
          </span>
          <textarea
            value={form.prompt_tts_text}
            onChange={(e) => setField('prompt_tts_text', e.target.value)}
            className="input"
            rows={3}
            placeholder="Welcome to Acme. Press 1 for sales, 2 for support."
          />
        </label>
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">
            Prompt audio path (set later via upload)
          </span>
          <input
            value={form.prompt_path}
            onChange={(e) => setField('prompt_path', e.target.value)}
            className="input font-mono text-xs"
            placeholder="/var/lib/dialeros/audio/menus/<id>.wav"
          />
        </label>
      </fieldset>

      <fieldset className="border border-border rounded p-4">
        <legend className="text-xs uppercase tracking-wide text-fg-subtle px-2">
          Timing
        </legend>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm flex flex-col gap-1">
            <span className="text-fg-subtle">Timeout (seconds)</span>
            <input
              type="number"
              min={1}
              max={60}
              value={form.timeout_seconds}
              onChange={(e) =>
                setField('timeout_seconds', Number(e.target.value))
              }
              className="input"
            />
          </label>
          <label className="text-sm flex flex-col gap-1">
            <span className="text-fg-subtle">Max retries</span>
            <input
              type="number"
              min={1}
              max={10}
              value={form.max_retries}
              onChange={(e) =>
                setField('max_retries', Number(e.target.value))
              }
              className="input"
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="border border-border rounded p-4">
        <legend className="text-xs uppercase tracking-wide text-fg-subtle px-2">
          Options (DTMF digits)
        </legend>
        {form.options.length === 0 ? (
          <p className="text-fg-subtle text-sm mb-3">
            No options yet. Add at least one digit handler.
          </p>
        ) : (
          <table className="w-full text-sm mb-3">
            <thead className="text-fg-subtle text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="py-1.5 w-16">Digit</th>
                <th className="py-1.5">Label</th>
                <th className="py-1.5 w-40">Action</th>
                <th className="py-1.5">Value</th>
                <th className="py-1.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {form.options.map((o, idx) => (
                <tr key={idx} className="border-t border-border">
                  <td className="py-1.5 pr-2">
                    <select
                      value={o.digit}
                      onChange={(e) =>
                        setOption(idx, 'digit', e.target.value)
                      }
                      className="input w-full"
                    >
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'].map(
                        (d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ),
                      )}
                    </select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      value={o.label}
                      onChange={(e) =>
                        setOption(idx, 'label', e.target.value)
                      }
                      className="input w-full"
                      placeholder="Sales"
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <select
                      value={o.action_type}
                      onChange={(e) =>
                        setOption(idx, 'action_type', e.target.value)
                      }
                      className="input w-full"
                    >
                      {ACTION_TYPES.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      value={o.action_value}
                      onChange={(e) =>
                        setOption(idx, 'action_value', e.target.value)
                      }
                      className="input w-full font-mono text-xs"
                      placeholder={
                        o.action_type === 'in_group'
                          ? 'in-group-id'
                          : o.action_type === 'extension'
                            ? '1001'
                            : o.action_type === 'did'
                              ? '+15551234567'
                              : o.action_type === 'call_menu'
                                ? 'sub-menu-id'
                                : o.action_type === 'voicemail'
                                  ? 'path/to/greeting.wav (optional)'
                                  : '(ignored)'
                      }
                    />
                  </td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => removeOption(idx)}
                      className="text-error hover:text-error-strong"
                      aria-label="Remove option"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button
          type="button"
          onClick={addOption}
          disabled={form.options.length >= 12}
          className="text-sm bg-card-hover hover:bg-card-hover/70 px-3 py-1.5 rounded disabled:opacity-50"
        >
          + Add option
        </button>
      </fieldset>

      <fieldset className="border border-border rounded p-4">
        <legend className="text-xs uppercase tracking-wide text-fg-subtle px-2">
          Default action (no input / max retries hit)
        </legend>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm flex flex-col gap-1">
            <span className="text-fg-subtle">Action</span>
            <select
              value={form.default_action_type}
              onChange={(e) =>
                setField('default_action_type', e.target.value)
              }
              className="input"
            >
              {ACTION_TYPES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm flex flex-col gap-1">
            <span className="text-fg-subtle">Value</span>
            <input
              value={form.default_action_value}
              onChange={(e) =>
                setField('default_action_value', e.target.value)
              }
              className="input font-mono text-xs"
            />
          </label>
        </div>
      </fieldset>

      {error ? <div className="text-error text-sm">{error}</div> : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          {submitting ? 'Saving…' : menuId ? 'Save changes' : 'Create menu'}
        </button>
        {menuId ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting}
            className="text-error hover:text-error-strong text-sm"
          >
            Delete menu
          </button>
        ) : null}
      </div>
    </form>
  );
}
