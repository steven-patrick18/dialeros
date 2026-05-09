'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const TYPES = [
  'outbound_manual',
  'outbound_progressive',
  'outbound_predictive',
  'outbound_preview',
  'inbound_queue',
  'survey',
  'blended',
] as const;
type Type = (typeof TYPES)[number];

const TYPE_HINTS: Record<Type, string> = {
  outbound_manual:
    'Agent triggers each dial. Lowest concurrency, highest control. Works today.',
  outbound_progressive:
    'System dials 1:1 when an agent becomes available. No abandoned calls. Activates once the pacing engine lands (iter 11).',
  outbound_predictive:
    'System dials more lines than agents (ratio > 1.0) and manages drop rate against the FCC threshold. Activates with the pacing engine (iter 11).',
  outbound_preview:
    'Agent previews the lead, then triggers the dial. For high-touch sales. Activates once the in-call agent UI lands (iter 12+).',
  inbound_queue:
    "No outbound dialing. DIDs you attach to an in-group route inbound calls to this campaign's pool. Configure DIDs under In-Groups.",
  survey:
    'Outbound calls connect to a call menu (IVR) instead of an agent. For NPS or automated outreach. Needs the IVR builder (iter 12+).',
  blended:
    'Same agent pool handles inbound and outbound. Switches based on inbound queue depth. Needs in-groups + pacing engine.',
};

export function AddCampaignForm({
  routePlans,
  leadLists,
}: {
  routePlans: Array<{ id: string; name: string }>;
  leadLists: Array<{ id: string; name: string; lead_count: number }>;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<Type>('outbound_manual');
  const [routePlanId, setRoutePlanId] = useState(routePlans[0]?.id ?? '');
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [hasWindow, setHasWindow] = useState(false);

  function toggleList(id: string) {
    setSelectedListIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    if (selectedListIds.length === 0) {
      setError('Select at least one lead list.');
      setSubmitting(false);
      return;
    }

    const fd = new FormData(e.currentTarget);
    const body = {
      name: String(fd.get('name') ?? ''),
      description: String(fd.get('description') ?? '').trim() || undefined,
      type,
      route_plan_id: routePlanId,
      lead_list_ids: selectedListIds,
      base_ratio: Number(fd.get('base_ratio') ?? 1.0),
      call_window_start: hasWindow
        ? String(fd.get('call_window_start') ?? '')
        : undefined,
      call_window_end: hasWindow
        ? String(fd.get('call_window_end') ?? '')
        : undefined,
      max_abandon_pct: Number(fd.get('max_abandon_pct') ?? 3.0),
    };

    const res = await fetch('/api/campaigns', {
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
    router.push(`/campaigns/${id}`);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <Section title="Identity">
        <Field label="Name">
          <input
            name="name"
            required
            className="input"
            placeholder="sales-usa-cold"
            autoComplete="off"
          />
        </Field>
        <Field label="Description" hint="Optional.">
          <input
            name="description"
            className="input"
            placeholder="Q1 cold outbound, business hours only"
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

      <Section title="Route Plan">
        <Field label="Route plan" hint="Only enabled route plans are shown.">
          <select
            value={routePlanId}
            onChange={(e) => setRoutePlanId(e.target.value)}
            className="input"
            required
          >
            {routePlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Lead Lists">
        <p className="text-xs text-fg-subtle -mt-1 mb-2">
          Select one or more lists. The campaign will draw leads from all
          selected lists.
        </p>
        <div className="space-y-1">
          {leadLists.map((l) => (
            <label
              key={l.id}
              className="flex items-center gap-2 px-3 py-2 border border-border rounded text-sm cursor-pointer hover:bg-card-hover"
            >
              <input
                type="checkbox"
                checked={selectedListIds.includes(l.id)}
                onChange={() => toggleList(l.id)}
              />
              <span>{l.name}</span>
              <span className="text-fg-subtle text-xs ml-auto tabular-nums">
                {l.lead_count.toLocaleString()} leads
              </span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Pacing">
        <Field
          label="Base ratio"
          hint="Lines dialed per available agent. 1.0 = progressive (1:1). >1.0 = predictive (predictive needs the iter 10 pacing engine to land first)."
        >
          <input
            name="base_ratio"
            type="number"
            step="0.1"
            min={0.5}
            max={10}
            defaultValue={type === 'outbound_progressive' ? '1.0' : '1.0'}
            className="input"
          />
        </Field>
      </Section>

      <Section title="Compliance">
        <label className="flex items-center gap-2 text-sm mb-2">
          <input
            type="checkbox"
            checked={hasWindow}
            onChange={(e) => setHasWindow(e.target.checked)}
          />
          <span>Restrict call window (caller-local time)</span>
        </label>
        {hasWindow && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start" hint="HH:MM 24h. e.g. 09:00">
              <input
                name="call_window_start"
                required
                placeholder="09:00"
                pattern="^([01]\d|2[0-3]):[0-5]\d$"
                className="input"
              />
            </Field>
            <Field label="End" hint="HH:MM 24h. e.g. 21:00">
              <input
                name="call_window_end"
                required
                placeholder="21:00"
                pattern="^([01]\d|2[0-3]):[0-5]\d$"
                className="input"
              />
            </Field>
          </div>
        )}
        <Field
          label="Max abandon %"
          hint="FCC default is 3%. Pacing engine will throttle when approaching."
        >
          <input
            name="max_abandon_pct"
            type="number"
            step="0.1"
            min={0}
            max={100}
            defaultValue={3.0}
            className="input"
          />
        </Field>
      </Section>

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
          {submitting ? 'Creating…' : 'Create campaign'}
        </button>
        <Link
          href="/campaigns"
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
