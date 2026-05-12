'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export type InlineField =
  | {
      type: 'text' | 'textarea';
      name: string;
      label: string;
      value: string | null;
      hint?: string;
      placeholder?: string;
      maxLength?: number;
    }
  | {
      type: 'number';
      name: string;
      label: string;
      value: number;
      hint?: string;
      min?: number;
      max?: number;
      step?: number;
    }
  | {
      type: 'time';
      name: string;
      label: string;
      value: string | null; // 'HH:MM' or null
      hint?: string;
    };

/**
 * Iter 25 — ViciDial-style inline editor for a card. Each field is
 * always-edit (no separate "Edit" button). The Save button enables when
 * any field diverges from the initial value, and PUTs the full diff
 * to `endpoint` in one request. Fields not in the diff are omitted so
 * partial-update validators stay happy.
 */
export function InlineCardForm({
  title,
  fields,
  endpoint,
  method = 'PUT',
  helpText,
}: {
  title: string;
  fields: InlineField[];
  endpoint: string;
  method?: 'PUT' | 'PATCH' | 'POST';
  helpText?: string;
}) {
  const router = useRouter();
  const initial = useMemo(
    () =>
      Object.fromEntries(fields.map((f) => [f.name, normalizeForState(f)])) as Record<
        string,
        string | number | null
      >,
    [fields],
  );
  const [values, setValues] = useState<Record<string, string | number | null>>(
    () => ({ ...initial }),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  const dirty = useMemo(() => {
    for (const f of fields) {
      if (!shallowEq(values[f.name], initial[f.name])) return true;
    }
    return false;
  }, [values, initial, fields]);

  function set(name: string, raw: string) {
    const f = fields.find((x) => x.name === name)!;
    let v: string | number | null;
    if (f.type === 'number') {
      v = raw === '' ? NaN : Number(raw);
      if (Number.isNaN(v)) v = NaN; // keep NaN to flag invalid
    } else if (f.type === 'time') {
      v = raw === '' ? null : raw;
    } else {
      v = raw;
    }
    setValues((prev) => ({ ...prev, [name]: v }));
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      // Build diff payload — only changed fields, normalized for the API.
      const payload: Record<string, unknown> = {};
      for (const f of fields) {
        const cur = values[f.name];
        const orig = initial[f.name];
        if (shallowEq(cur, orig)) continue;
        if (f.type === 'number') {
          if (typeof cur !== 'number' || Number.isNaN(cur)) {
            setMsg({
              tone: 'err',
              text: `${f.label} must be a number.`,
            });
            return;
          }
          payload[f.name] = cur;
        } else if (f.type === 'time') {
          // Empty time → '' so server treats it as cleared.
          payload[f.name] = cur ?? '';
        } else {
          payload[f.name] = cur ?? '';
        }
      }
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tone: 'err', text: j.error ?? `save failed (${res.status})` });
        return;
      }
      setMsg({ tone: 'ok', text: 'Saved.' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setValues({ ...initial });
    setMsg(null);
  }

  return (
    <div className="border border-border rounded p-4">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
        {title}
      </h2>
      <div className="space-y-3">
        {fields.map((f) => (
          <div key={f.name} className="text-sm">
            <label className="block">
              <div className="text-xs text-fg-subtle mb-1 flex items-center gap-2">
                <span>{f.label}</span>
                {f.hint && <Hint text={f.hint} />}
              </div>
              {renderInput(f, values[f.name] ?? null, (raw) => set(f.name, raw))}
            </label>
          </div>
        ))}
      </div>
      {helpText && (
        <p className="text-xs text-fg-subtle mt-3">{helpText}</p>
      )}
      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {dirty && !busy && (
          <button
            type="button"
            onClick={reset}
            className="text-xs text-fg-muted hover:text-fg"
          >
            Reset
          </button>
        )}
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
  );
}

function renderInput(
  f: InlineField,
  value: string | number | null,
  onChange: (raw: string) => void,
) {
  if (f.type === 'textarea') {
    return (
      <textarea
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={f.placeholder}
        maxLength={f.maxLength}
        className="input h-20 text-sm w-full"
      />
    );
  }
  if (f.type === 'number') {
    return (
      <input
        type="number"
        value={Number.isNaN(value as number) ? '' : (value as number)}
        onChange={(e) => onChange(e.target.value)}
        min={f.min}
        max={f.max}
        step={f.step ?? 'any'}
        className="input text-sm w-32 tabular-nums"
      />
    );
  }
  if (f.type === 'time') {
    return (
      <input
        type="time"
        value={(value as string | null) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="input text-sm w-32 font-mono"
      />
    );
  }
  return (
    <input
      type="text"
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={f.placeholder}
      maxLength={f.maxLength}
      className="input text-sm w-full"
    />
  );
}

function Hint({ text }: { text: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-border text-[10px] text-fg-muted hover:text-fg hover:border-fg-muted cursor-help"
      title={text}
      aria-label={text}
    >
      ?
    </span>
  );
}

function normalizeForState(f: InlineField): string | number | null {
  if (f.type === 'number') return f.value as number;
  return (f.value as string | null) ?? null;
}

function shallowEq(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return a === b;
  }
  // Treat null and '' as equivalent for text/time fields so a never-set
  // field that the user clears doesn't read as dirty.
  if ((a == null || a === '') && (b == null || b === '')) return true;
  return a === b;
}
