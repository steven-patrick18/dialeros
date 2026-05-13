'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const TYPES = ['inbound_queue', 'transfer_target', 'both'] as const;
const WHITELIST_MODES = ['none', 'static', 'cluster_wide_leads'] as const;
const ROUTING = ['ring_all', 'longest_idle', 'random'] as const;
const OFF_LIST = ['reject', 'fallback_announcement'] as const;

type WL = (typeof WHITELIST_MODES)[number];

interface GroupState {
  id: string;
  name: string;
  description: string | null;
  type: string;
  whitelist_mode: string;
  whitelist_static: string[];
  routing_strategy: string;
  max_wait_seconds: number;
  wrap_up_seconds: number;
  off_list_action: string;
  enabled: boolean;
  // Iter 153/155 — call menu wiring
  entry_call_menu_id: string | null;
  overflow_call_menu_id: string | null;
  after_hours_call_menu_id: string | null;
}

interface CallMenuOpt {
  id: string;
  name: string;
}

export function EditInGroupForm({ group }: { group: GroupState }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whitelistMode, setWhitelistMode] = useState<WL>(
    group.whitelist_mode as WL,
  );
  const [staticListText, setStaticListText] = useState(
    group.whitelist_static.join('\n'),
  );
  // Iter 155 — fetch call menus once for the 3 picker dropdowns.
  const [menus, setMenus] = useState<CallMenuOpt[]>([]);
  useEffect(() => {
    fetch('/api/call-menus', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((data: { menus: CallMenuOpt[] }) => setMenus(data.menus))
      .catch(() => setMenus([]));
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    let staticList: string[] = [];
    if (whitelistMode === 'static') {
      staticList = staticListText
        .split(/[,\s\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      name: String(fd.get('name') ?? ''),
      description: String(fd.get('description') ?? ''),
      type: String(fd.get('type') ?? group.type),
      whitelist_mode: whitelistMode,
      routing_strategy: String(
        fd.get('routing_strategy') ?? group.routing_strategy,
      ),
      max_wait_seconds: Number(fd.get('max_wait_seconds') ?? group.max_wait_seconds),
      wrap_up_seconds: Number(fd.get('wrap_up_seconds') ?? group.wrap_up_seconds),
      off_list_action: String(fd.get('off_list_action') ?? group.off_list_action),
      enabled: fd.get('enabled') === 'on',
      // Iter 155 — pass the 3 call menu IDs through. Empty string
      // becomes null server-side (Zod transforms).
      entry_call_menu_id: String(fd.get('entry_call_menu_id') ?? ''),
      overflow_call_menu_id: String(fd.get('overflow_call_menu_id') ?? ''),
      after_hours_call_menu_id: String(
        fd.get('after_hours_call_menu_id') ?? '',
      ),
    };
    if (whitelistMode === 'static') {
      body.whitelist_static = staticList;
    }

    const res = await fetch(`/api/in-groups/${group.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Failed (${res.status})`);
      setSubmitting(false);
      return;
    }
    router.push(`/in-groups/${group.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <Section title="Identity">
        <Field label="Name">
          <input
            name="name"
            required
            defaultValue={group.name}
            className="input"
            autoComplete="off"
          />
        </Field>
        <Field label="Description">
          <input
            name="description"
            defaultValue={group.description ?? ''}
            className="input"
            autoComplete="off"
          />
        </Field>
        <Field label="Type">
          <select name="type" defaultValue={group.type} className="input">
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Whitelist">
        <Field label="Mode">
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
          <Field label="Allowed numbers" hint="One per line, or comma-separated.">
            <textarea
              value={staticListText}
              onChange={(e) => setStaticListText(e.target.value)}
              rows={4}
              className="input font-mono text-xs"
            />
          </Field>
        )}
        <Field label="Off-list action">
          <select
            name="off_list_action"
            defaultValue={group.off_list_action}
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
            name="routing_strategy"
            defaultValue={group.routing_strategy}
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
          <Field label="Max wait (seconds)">
            <input
              name="max_wait_seconds"
              type="number"
              min={5}
              max={3600}
              defaultValue={group.max_wait_seconds}
              className="input"
            />
          </Field>
          <Field label="Wrap-up (seconds)">
            <input
              name="wrap_up_seconds"
              type="number"
              min={0}
              max={600}
              defaultValue={group.wrap_up_seconds}
              className="input"
            />
          </Field>
        </div>
      </Section>

      <Section title="Call menu wiring (iter 153/155)">
        <p className="text-xs text-fg-subtle mb-2">
          When set, inbound calls hit the chosen Call Menu instead
          of the default queue dispatch.{' '}
          <a href="/call-menus" className="text-link hover:underline">
            Manage Call Menus
          </a>
          .
        </p>
        <Field label="Entry menu (greets caller before queue dispatch)">
          <select
            name="entry_call_menu_id"
            defaultValue={group.entry_call_menu_id ?? ''}
            className="input"
          >
            <option value="">— none —</option>
            {menus.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Overflow menu (fires when no agent available)">
          <select
            name="overflow_call_menu_id"
            defaultValue={group.overflow_call_menu_id ?? ''}
            className="input"
          >
            <option value="">— none —</option>
            {menus.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="After-hours menu (fires outside call window)">
          <select
            name="after_hours_call_menu_id"
            defaultValue={group.after_hours_call_menu_id ?? ''}
            className="input"
          >
            <option value="">— none —</option>
            {menus.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <label className="flex items-center gap-2 text-sm">
        <input name="enabled" type="checkbox" defaultChecked={group.enabled} />
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
          {submitting ? 'Saving…' : 'Save changes'}
        </button>
        <Link
          href={`/in-groups/${group.id}`}
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
