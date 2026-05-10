'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

const STRATEGIES = ['passthrough', 'single', 'rotate'] as const;
type Strategy = (typeof STRATEGIES)[number];

const STRATEGY_HINTS: Record<Strategy, string> = {
  passthrough: 'Use whatever caller ID the lead specifies.',
  single: 'Always present the same caller ID.',
  rotate: 'Rotate through a pool of caller IDs.',
};

interface PlanState {
  id: string;
  name: string;
  description: string | null;
  primary_carrier_id: string;
  failover_carrier_ids: string[];
  cid_strategy: string;
  cid_single: string | null;
  cid_pool: string[];
  transform_strip_prefix: string | null;
  transform_add_prefix: string | null;
  enabled: boolean;
}

export function EditRoutePlanForm({
  plan,
  carriers,
}: {
  plan: PlanState;
  carriers: Array<{ id: string; name: string; host: string; enabled: boolean }>;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>(
    plan.cid_strategy as Strategy,
  );
  const [failoverIds, setFailoverIds] = useState<string[]>(
    plan.failover_carrier_ids,
  );
  const [cidPoolText, setCidPoolText] = useState(plan.cid_pool.join('\n'));

  const failoverChoices = useMemo(
    () => carriers.filter((c) => c.id !== plan.primary_carrier_id),
    [carriers, plan.primary_carrier_id],
  );

  function toggleFailover(id: string) {
    setFailoverIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    let parsedPool: string[] = [];
    if (strategy === 'rotate') {
      parsedPool = cidPoolText
        .split(/[,\s\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      name: String(fd.get('name') ?? ''),
      description: String(fd.get('description') ?? '').trim() || undefined,
      failover_carrier_ids: failoverIds,
      cid_strategy: strategy,
      cid_single:
        strategy === 'single'
          ? String(fd.get('cid_single') ?? '').trim() || undefined
          : undefined,
      cid_pool: strategy === 'rotate' ? parsedPool : undefined,
      transform_strip_prefix:
        String(fd.get('transform_strip_prefix') ?? ''),
      transform_add_prefix: String(fd.get('transform_add_prefix') ?? ''),
      enabled: fd.get('enabled') === 'on',
    };

    const res = await fetch(`/api/route-plans/${plan.id}`, {
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
    router.push(`/route-plans/${plan.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <Section title="Identity">
        <Field label="Name">
          <input
            name="name"
            required
            defaultValue={plan.name}
            className="input"
            autoComplete="off"
          />
        </Field>
        <Field label="Description">
          <input
            name="description"
            defaultValue={plan.description ?? ''}
            className="input"
            autoComplete="off"
          />
        </Field>
      </Section>

      {failoverChoices.length > 0 && (
        <Section title="Failover carriers">
          <p className="text-xs text-fg-subtle -mt-1 mb-2">
            Tried in order if primary fails.
          </p>
          <div className="space-y-1">
            {failoverChoices.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 px-3 py-2 border border-border rounded text-sm cursor-pointer hover:bg-card-hover"
              >
                <input
                  type="checkbox"
                  checked={failoverIds.includes(c.id)}
                  onChange={() => toggleFailover(c.id)}
                />
                <span>{c.name}</span>
                <span className="text-fg-subtle text-xs ml-auto font-mono">
                  {c.host}
                </span>
              </label>
            ))}
          </div>
        </Section>
      )}

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
          <Field label="Caller ID">
            <input
              name="cid_single"
              required
              defaultValue={plan.cid_single ?? ''}
              placeholder="+14155551234"
              className="input"
            />
          </Field>
        )}

        {strategy === 'rotate' && (
          <Field label="Pool" hint="One per line.">
            <textarea
              value={cidPoolText}
              onChange={(e) => setCidPoolText(e.target.value)}
              required
              rows={4}
              className="input font-mono text-xs"
            />
          </Field>
        )}
      </Section>

      <Section title="Number Transformation">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Strip prefix">
            <input
              name="transform_strip_prefix"
              defaultValue={plan.transform_strip_prefix ?? ''}
              className="input"
              maxLength={20}
            />
          </Field>
          <Field label="Add prefix">
            <input
              name="transform_add_prefix"
              defaultValue={plan.transform_add_prefix ?? ''}
              className="input"
              maxLength={20}
            />
          </Field>
        </div>
      </Section>

      <label className="flex items-center gap-2 text-sm">
        <input name="enabled" type="checkbox" defaultChecked={plan.enabled} />
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
          href={`/route-plans/${plan.id}`}
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
