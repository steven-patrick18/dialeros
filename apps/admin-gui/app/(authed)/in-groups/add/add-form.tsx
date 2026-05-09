'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const TYPES = ['inbound_queue', 'transfer_target', 'both'] as const;
const WHITELIST_MODES = ['none', 'static', 'cluster_wide_leads'] as const;
const ROUTING = ['ring_all', 'longest_idle', 'random'] as const;
const OFF_LIST = ['reject', 'fallback_announcement'] as const;

type Type = (typeof TYPES)[number];
type WL = (typeof WHITELIST_MODES)[number];
type Routing = (typeof ROUTING)[number];
type OffList = (typeof OFF_LIST)[number];

const TYPE_HINTS: Record<Type, string> = {
  inbound_queue:
    'Receives direct inbound calls via attached DIDs. Standard inbound queue.',
  transfer_target:
    'Only accepts calls transferred from other agents/groups. Not directly dialable.',
  both: 'Receives direct inbound and accepts transfers.',
};

const WL_HINTS: Record<WL, string> = {
  none: 'Accept any inbound caller.',
  static:
    'Only accept callers whose number is in the list below. Useful for VIP queues.',
  cluster_wide_leads:
    'Accept callers whose number exists in any lead list (any status, any campaign). Lost leads, current customers, DNC callbacks all get through. Pure spam (numbers never imported) is blocked.',
};

export function AddInGroupForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<Type>('inbound_queue');
  const [whitelistMode, setWhitelistMode] = useState<WL>('none');
  const [routing, setRouting] = useState<Routing>('ring_all');
  const [offList, setOffList] = useState<OffList>('reject');
  const [staticListText, setStaticListText] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const fd = new FormData(e.currentTarget);

    let staticList: string[] = [];
    if (whitelistMode === 'static') {
      staticList = staticListText
        .split(/[,\s\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (staticList.length === 0) {
        setError('Static whitelist needs at least one phone number.');
        setSubmitting(false);
        return;
      }
    }

    const body = {
      name: String(fd.get('name') ?? ''),
      description: String(fd.get('description') ?? '').trim() || undefined,
      type,
      whitelist_mode: whitelistMode,
      whitelist_static: staticList,
      routing_strategy: routing,
      max_wait_seconds: Number(fd.get('max_wait_seconds') ?? 60),
      wrap_up_seconds: Number(fd.get('wrap_up_seconds') ?? 10),
      off_list_action: offList,
      enabled: fd.get('enabled') === 'on',
    };

    const res = await fetch('/api/in-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Failed (${res.status})`);
      setSubmitting(false);
      return;
    }
    const { id } = (await res.json()) as { id: string };
    router.push(`/in-groups/${id}`);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <Section title="Identity">
        <Field label="Name">
          <input
            name="name"
            required
            className="input"
            placeholder="sales_inbound"
            autoComplete="off"
          />
        </Field>
        <Field label="Description" hint="Optional.">
          <input
            name="description"
            className="input"
            placeholder="Main sales inbound queue, business hours"
            autoComplete="off"
          />
        </Field>
        <Field label="Type" hint={TYPE_HINTS[type]}>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as Type)}
            className="input"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Whitelist">
        <Field label="Mode" hint={WL_HINTS[whitelistMode]}>
          <select
            value={whitelistMode}
            onChange={(e) => setWhitelistMode(e.target.value as WL)}
            className="input"
          >
            {WHITELIST_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        {whitelistMode === 'static' && (
          <Field
            label="Allowed numbers"
            hint="One per line, or comma-separated. Same phone format as leads (digits with optional +)."
          >
            <textarea
              value={staticListText}
              onChange={(e) => setStaticListText(e.target.value)}
              rows={4}
              className="input font-mono text-xs"
              placeholder="+14155551234&#10;+14155551235"
            />
          </Field>
        )}
        <Field label="Off-list action" hint="What to do when caller fails the whitelist check.">
          <select
            value={offList}
            onChange={(e) => setOffList(e.target.value as OffList)}
            className="input"
          >
            {OFF_LIST.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Routing">
        <Field label="Strategy">
          <select
            value={routing}
            onChange={(e) => setRouting(e.target.value as Routing)}
            className="input"
          >
            {ROUTING.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Max wait (seconds)" hint="Caller is ejected after this.">
            <input
              name="max_wait_seconds"
              type="number"
              min={5}
              max={3600}
              defaultValue={60}
              className="input"
            />
          </Field>
          <Field label="Wrap-up (seconds)" hint="After-call buffer before agent goes available again.">
            <input
              name="wrap_up_seconds"
              type="number"
              min={0}
              max={600}
              defaultValue={10}
              className="input"
            />
          </Field>
        </div>
      </Section>

      <label className="flex items-center gap-2 text-sm">
        <input name="enabled" type="checkbox" defaultChecked />
        <span>Enabled</span>
      </label>

      {error && (
        <div className="border border-error/50 bg-error/10 text-error text-sm rounded p-3">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg px-4 py-2 rounded text-sm"
        >
          {submitting ? 'Creating…' : 'Create in-group'}
        </button>
        <Link
          href="/in-groups"
          className="px-4 py-2 rounded text-sm hover:bg-card-hover text-fg-muted"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 border border-border rounded p-4">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted">{title}</h2>
      {children}
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
