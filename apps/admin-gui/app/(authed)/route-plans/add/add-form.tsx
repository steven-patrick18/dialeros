'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  CarriersTableEditor,
  type CarrierOption,
  type CarrierRow,
} from '@/components/carriers-table-editor';

interface CidGroupOption {
  id: string;
  name: string;
  strategy: string;
  cid_count: number;
}

const STRATEGIES = ['passthrough', 'single', 'rotate', 'groups'] as const;
type Strategy = (typeof STRATEGIES)[number];

const STRATEGY_HINTS: Record<Strategy, string> = {
  passthrough: 'Use whatever caller ID the lead specifies (or campaign default).',
  single: 'Always present the same caller ID.',
  rotate: 'Rotate through an inline pool of caller IDs entered below.',
  groups:
    'Pull caller IDs from one or more reusable CID Groups. Each group has its own rotation logic.',
};

export function AddRoutePlanForm({
  carriers,
  cidGroups,
}: {
  carriers: CarrierOption[];
  cidGroups: CidGroupOption[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Iter 74 — single carriers list with priority + ports per row.
  // Default seed: first available carrier at priority 1 / 30 ports.
  const [carrierRows, setCarrierRows] = useState<CarrierRow[]>(
    carriers[0]
      ? [{ carrier_id: carriers[0].id, priority: 1, ports: 30 }]
      : [],
  );
  const [strategy, setStrategy] = useState<Strategy>('passthrough');
  const [cidPool, setCidPool] = useState('');
  const [cidGroupIds, setCidGroupIds] = useState<string[]>([]);

  function toggleCidGroup(id: string) {
    setCidGroupIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const fd = new FormData(e.currentTarget);

    let parsedPool: string[] = [];
    if (strategy === 'rotate') {
      parsedPool = cidPool
        .split(/[,\s\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    if (carrierRows.length === 0) {
      setError('Add at least one carrier.');
      setSubmitting(false);
      return;
    }

    const body = {
      name: String(fd.get('name') ?? ''),
      description:
        String(fd.get('description') ?? '').trim() || undefined,
      // Iter 74 — the carriers array is the new source of truth.
      // primary_carrier_id and failover_carrier_ids are derived
      // server-side from priorities.
      carriers: carrierRows,
      cid_strategy: strategy,
      cid_single:
        strategy === 'single'
          ? String(fd.get('cid_single') ?? '').trim() || undefined
          : undefined,
      cid_pool: parsedPool,
      cid_group_ids: strategy === 'groups' ? cidGroupIds : [],
      transform_strip_prefix:
        String(fd.get('transform_strip_prefix') ?? '').trim() || undefined,
      transform_add_prefix:
        String(fd.get('transform_add_prefix') ?? '').trim() || undefined,
      enabled: fd.get('enabled') === 'on',
    };

    const res = await fetch('/api/route-plans', {
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
    router.push(`/route-plans/${id}`);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <Section title="Identity">
        <Field
          label="Name"
          hint="Alphanumeric, dashes, underscores. Referenced from campaign config."
        >
          <input
            name="name"
            required
            className="input"
            placeholder="sales-usa"
            autoComplete="off"
          />
        </Field>
        <Field label="Description" hint="Optional.">
          <input
            name="description"
            className="input"
            placeholder="US sales outbound, business hours only"
            autoComplete="off"
          />
        </Field>
      </Section>

      <Section title="Carriers">
        <p className="text-xs text-fg-subtle -mt-1 mb-2">
          Lower priority dials first. Equal priorities round-robin within
          their tier (e.g. <span className="font-mono">1, 1</span> = 50/50).
          Ports caps concurrent in-flight calls per carrier.
        </p>
        <CarriersTableEditor
          mode="controlled"
          carriers={carriers}
          initialRows={carrierRows}
          onChange={setCarrierRows}
        />
      </Section>

      <Section title="Caller ID">
        <Field label="Strategy" hint={STRATEGY_HINTS[strategy]}>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as Strategy)}
            className="input"
          >
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        {strategy === 'single' && (
          <Field label="Caller ID" hint="Phone number, e.g. +14155551234">
            <input
              name="cid_single"
              required
              className="input"
              placeholder="+14155551234"
              autoComplete="off"
            />
          </Field>
        )}

        {strategy === 'rotate' && (
          <Field
            label="Pool"
            hint="One number per line, or comma-separated."
          >
            <textarea
              value={cidPool}
              onChange={(e) => setCidPool(e.target.value)}
              required
              rows={4}
              className="input font-mono text-xs"
              placeholder="+14155551234&#10;+14155551235&#10;+14155551236"
            />
          </Field>
        )}

        {strategy === 'groups' && (
          <Field
            label="CID Groups"
            hint="Pick one or more groups. Pacer rotates across groups per call, then applies each group's own logic."
          >
            {cidGroups.length === 0 ? (
              <div className="border border-dashed border-border rounded p-3 text-xs text-fg-subtle">
                No CID groups exist yet.{' '}
                <Link href="/cid-groups/add" className="underline">
                  Create one
                </Link>{' '}
                first.
              </div>
            ) : (
              <div className="space-y-1">
                {cidGroups.map((g) => (
                  <label
                    key={g.id}
                    className="flex items-center gap-2 px-3 py-2 border border-border rounded text-sm cursor-pointer hover:bg-card-hover"
                  >
                    <input
                      type="checkbox"
                      checked={cidGroupIds.includes(g.id)}
                      onChange={() => toggleCidGroup(g.id)}
                    />
                    <span>{g.name}</span>
                    <span className="text-fg-subtle text-xs ml-auto font-mono">
                      {g.strategy} · {g.cid_count} CID
                      {g.cid_count === 1 ? '' : 's'}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Field>
        )}
      </Section>

      <Section title="Number Transformation">
        <p className="text-xs text-fg-subtle -mt-1 mb-2">
          Applied to the dialed number before sending to the carrier.
          Strip runs first, then add.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Strip prefix" hint="e.g. + or 011">
            <input
              name="transform_strip_prefix"
              className="input"
              placeholder="+"
              autoComplete="off"
              maxLength={20}
            />
          </Field>
          <Field label="Add prefix" hint="e.g. 1 for US format">
            <input
              name="transform_add_prefix"
              className="input"
              placeholder="1"
              autoComplete="off"
              maxLength={20}
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

      <div className="pt-2 flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg px-4 py-2 rounded text-sm"
        >
          {submitting ? 'Savingâ€¦' : 'Add route plan'}
        </button>
        <Link
          href="/route-plans"
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
