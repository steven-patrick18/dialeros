'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Iter 160 — Per-call action buttons on /calls/[id]. Admin /
// supervisor only — the page-level role gate already enforces
// this; we show the card for non-privileged roles too with the
// buttons disabled + a note explaining why.

type Action =
  | 'redial'
  | 'send_to_dnc'
  | 'mark_wrong_number'
  | 'schedule_callback';

export function CallActionsCard({
  callId,
  leadPhone,
  canAct,
}: {
  callId: number;
  leadPhone: string;
  canAct: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fire(
    action: Action,
    body: Record<string, unknown> = {},
  ): Promise<void> {
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/calls/${callId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action, ...body }),
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
      const data = (await res.json()) as {
        ok: boolean;
        lead_status?: string;
        dnc_phone?: string;
        callback_at?: string;
      };
      if (action === 'redial')
        setMessage(`Lead reset to NEW — pacer will redial on the next sweep.`);
      else if (action === 'send_to_dnc')
        setMessage(
          `Added ${data.dnc_phone ?? leadPhone} to DNC. Lead status: DNC.`,
        );
      else if (action === 'mark_wrong_number')
        setMessage('Lead marked as BAD_NUMBER — pacer will skip on retries.');
      else if (action === 'schedule_callback')
        setMessage(
          `Callback scheduled for ${data.callback_at ? new Date(data.callback_at).toLocaleString() : '—'}.`,
        );
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function handleRedial() {
    if (
      !confirm(
        'Reset this lead’s status to NEW so the pacer redials it? ' +
          'Useful after a misclick disposition or a failed bridge.',
      )
    )
      return;
    void fire('redial');
  }

  function handleDnc() {
    const reason = prompt(
      `Add ${leadPhone} to the DNC list? Optional reason:`,
      '',
    );
    if (reason === null) return;
    void fire('send_to_dnc', { reason: reason || undefined });
  }

  function handleWrongNumber() {
    if (
      !confirm(
        `Mark ${leadPhone} as BAD_NUMBER? Pacer will skip on future retries.`,
      )
    )
      return;
    void fire('mark_wrong_number');
  }

  function handleCallback() {
    // Default to tomorrow at the same local time of day; operator can edit.
    const dflt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const localFmt = `${dflt.getFullYear()}-${pad(dflt.getMonth() + 1)}-${pad(dflt.getDate())}T${pad(dflt.getHours())}:${pad(dflt.getMinutes())}`;
    const input = prompt(
      'Schedule callback at (YYYY-MM-DDTHH:MM, local time):',
      localFmt,
    );
    if (!input) return;
    const d = new Date(input);
    if (!Number.isFinite(d.getTime())) {
      setError('Bad date format. Use YYYY-MM-DDTHH:MM.');
      return;
    }
    void fire('schedule_callback', { callback_at: d.toISOString() });
  }

  return (
    <section className="border border-border rounded p-4 bg-card">
      <h2 className="text-xs uppercase tracking-wide text-fg-subtle mb-3">
        Actions
      </h2>
      {!canAct ? (
        <p className="text-fg-subtle text-sm">
          Admin or supervisor role required to take action on this call.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRedial}
              disabled={busy !== null}
              className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-50"
            >
              {busy === 'redial' ? 'Redialing…' : '↻ Redial'}
            </button>
            <button
              type="button"
              onClick={handleCallback}
              disabled={busy !== null}
              className="bg-card-hover hover:bg-card-hover/70 text-fg px-3 py-1.5 rounded text-sm disabled:opacity-50 border border-border"
            >
              {busy === 'schedule_callback'
                ? 'Scheduling…'
                : '📅 Schedule callback'}
            </button>
            <button
              type="button"
              onClick={handleWrongNumber}
              disabled={busy !== null}
              className="bg-card-hover hover:bg-card-hover/70 text-warn px-3 py-1.5 rounded text-sm disabled:opacity-50 border border-warn/40"
            >
              {busy === 'mark_wrong_number'
                ? 'Marking…'
                : '✕ Mark wrong number'}
            </button>
            <button
              type="button"
              onClick={handleDnc}
              disabled={busy !== null}
              className="bg-card-hover hover:bg-card-hover/70 text-error px-3 py-1.5 rounded text-sm disabled:opacity-50 border border-error/40"
            >
              {busy === 'send_to_dnc' ? 'Adding…' : '🚫 Send to DNC'}
            </button>
          </div>
          {message ? (
            <p className="text-success text-sm">{message}</p>
          ) : null}
          {error ? <p className="text-error text-sm">{error}</p> : null}
          <p className="text-xs text-fg-subtle">
            Redial resets the lead to NEW for the next pacer sweep.
            DNC is permanent and compliance-relevant. Wrong-number
            marks the lead as BAD_NUMBER so retries skip it. All
            actions audit-log under the actor user.
          </p>
        </div>
      )}
    </section>
  );
}
