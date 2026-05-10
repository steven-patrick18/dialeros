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

interface CampaignState {
  id: string;
  name: string;
  description: string | null;
  type: string;
  base_ratio: number;
  call_window_start: string | null;
  call_window_end: string | null;
  max_abandon_pct: number;
}

export function EditCampaignForm({ campaign }: { campaign: CampaignState }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasWindow, setHasWindow] = useState(
    !!campaign.call_window_start && !!campaign.call_window_end,
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      name: String(fd.get('name') ?? ''),
      description: String(fd.get('description') ?? ''),
      type: String(fd.get('type') ?? campaign.type),
      base_ratio: Number(fd.get('base_ratio') ?? campaign.base_ratio),
      max_abandon_pct: Number(
        fd.get('max_abandon_pct') ?? campaign.max_abandon_pct,
      ),
    };
    if (hasWindow) {
      body.call_window_start = String(fd.get('call_window_start') ?? '');
      body.call_window_end = String(fd.get('call_window_end') ?? '');
    } else {
      body.call_window_start = '';
      body.call_window_end = '';
    }

    const res = await fetch(`/api/campaigns/${campaign.id}`, {
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
    router.push(`/campaigns/${campaign.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <Section title="Identity">
        <Field label="Name">
          <input
            name="name"
            required
            defaultValue={campaign.name}
            className="input"
            autoComplete="off"
          />
        </Field>
        <Field label="Description">
          <input
            name="description"
            defaultValue={campaign.description ?? ''}
            className="input"
            autoComplete="off"
          />
        </Field>
        <Field label="Type">
          <select name="type" defaultValue={campaign.type} className="input">
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Pacing">
        <Field label="Base ratio" hint="Lines dialed per available agent.">
          <input
            name="base_ratio"
            type="number"
            step="0.1"
            min={0.5}
            max={10}
            defaultValue={campaign.base_ratio}
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
            <Field label="Start" hint="HH:MM 24h">
              <input
                name="call_window_start"
                required
                placeholder="09:00"
                defaultValue={campaign.call_window_start ?? ''}
                pattern="^([01]\d|2[0-3]):[0-5]\d$"
                className="input"
              />
            </Field>
            <Field label="End" hint="HH:MM 24h">
              <input
                name="call_window_end"
                required
                placeholder="21:00"
                defaultValue={campaign.call_window_end ?? ''}
                pattern="^([01]\d|2[0-3]):[0-5]\d$"
                className="input"
              />
            </Field>
          </div>
        )}
        <Field label="Max abandon %">
          <input
            name="max_abandon_pct"
            type="number"
            step="0.1"
            min={0}
            max={100}
            defaultValue={campaign.max_abandon_pct}
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
          {submitting ? 'Saving…' : 'Save changes'}
        </button>
        <Link
          href={`/campaigns/${campaign.id}`}
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
