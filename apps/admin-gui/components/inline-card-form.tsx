'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export type InlineField =
  | {
      type: 'text' | 'textarea' | 'password';
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
    }
  | {
      type: 'select';
      name: string;
      label: string;
      value: string;
      options: Array<{ value: string; label: string }>;
      hint?: string;
    }
  | {
      type: 'boolean';
      name: string;
      label: string;
      value: boolean;
      hint?: string;
    }
  | {
      type: 'lines';
      // Free-text multiline input that splits to a string[] on save.
      // Useful for whitelist phone numbers, CID pool, etc.
      name: string;
      label: string;
      value: string[];
      hint?: string;
      placeholder?: string;
    };

/**
 * Iter 25/26 — ViciDial-style always-edit card.
 *
 * Every field is rendered as its native input (no separate Edit button).
 * The Save button enables when the desired set diverges from the
 * initial values, and POSTs ONLY the diff so the API's partial-update
 * validators stay happy. Default method is PUT — pass `method` to
 * override.
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
  const initial = useMemo(() => {
    const out: Record<string, FieldValue> = {};
    for (const f of fields) out[f.name] = normalizeForState(f);
    return out;
  }, [fields]);
  const [values, setValues] = useState<Record<string, FieldValue>>(() => ({
    ...initial,
  }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  const dirty = useMemo(() => {
    for (const f of fields) {
      if (!fieldEq(values[f.name], initial[f.name])) return true;
    }
    return false;
  }, [values, initial, fields]);

  function setRaw(name: string, raw: string | boolean) {
    const f = fields.find((x) => x.name === name)!;
    let v: FieldValue;
    if (f.type === 'number') {
      const n = raw === '' ? NaN : Number(raw);
      v = n;
    } else if (f.type === 'time') {
      v = raw === '' ? null : (raw as string);
    } else if (f.type === 'boolean') {
      v = !!raw;
    } else if (f.type === 'lines') {
      // Split on newlines, trim, drop empties.
      v = String(raw)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else {
      v = raw as string;
    }
    setValues((prev) => ({ ...prev, [name]: v }));
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of fields) {
        const cur = values[f.name];
        const orig = initial[f.name];
        if (fieldEq(cur, orig)) continue;
        if (f.type === 'number') {
          if (typeof cur !== 'number' || Number.isNaN(cur)) {
            setMsg({ tone: 'err', text: `${f.label} must be a number.` });
            return;
          }
          payload[f.name] = cur;
        } else if (f.type === 'time') {
          payload[f.name] = (cur as string | null) ?? '';
        } else if (f.type === 'boolean') {
          payload[f.name] = !!cur;
        } else if (f.type === 'lines') {
          payload[f.name] = cur as string[];
        } else if (f.type === 'select') {
          payload[f.name] = cur as string;
        } else {
          payload[f.name] = (cur as string | null) ?? '';
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
              {renderInput(f, values[f.name], (raw) => setRaw(f.name, raw))}
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

type FieldValue = string | number | boolean | string[] | null;

function renderInput(
  f: InlineField,
  value: FieldValue | undefined,
  onChange: (raw: string | boolean) => void,
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
    const n = value as number;
    return (
      <input
        type="number"
        value={Number.isNaN(n) ? '' : n}
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
  if (f.type === 'select') {
    return (
      <select
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="input text-sm"
      >
        {f.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (f.type === 'boolean') {
    const checked = !!value;
    return (
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="cursor-pointer"
        />
        <span className="text-sm">{checked ? 'Enabled' : 'Disabled'}</span>
      </label>
    );
  }
  if (f.type === 'lines') {
    const v = (value as string[]) ?? [];
    return (
      <textarea
        value={v.join('\n')}
        onChange={(e) => onChange(e.target.value)}
        placeholder={f.placeholder}
        className="input h-32 text-sm w-full font-mono"
      />
    );
  }
  if (f.type === 'password') {
    return (
      <input
        type="password"
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={f.placeholder}
        maxLength={f.maxLength}
        autoComplete="new-password"
        className="input text-sm w-full"
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

function normalizeForState(f: InlineField): FieldValue {
  if (f.type === 'number') return f.value as number;
  if (f.type === 'boolean') return f.value;
  if (f.type === 'lines') return f.value;
  if (f.type === 'select') return f.value;
  return (f.value as string | null) ?? null;
}

function fieldEq(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return a === b;
  }
  // Treat null and '' as equivalent for text/time fields.
  if ((a == null || a === '') && (b == null || b === '')) return true;
  return a === b;
}
