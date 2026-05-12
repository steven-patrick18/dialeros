'use client';

import { useState } from 'react';
import { useSoftphone } from '@/components/softphone';

// Iter 118 — transfer modal. Replaces the iter-47 window.prompt
// blind transfer with a proper two-mode dialog:
//
//   BLIND     — fire-and-forget SIP REFER via the softphone's
//               sip.js session. Agent drops out immediately.
//               Same behavior iter 47 shipped.
//   ATTENDED  — server-side flow:
//               1. POST /api/agent/transfer/consult { destination }
//                  — server holds customer leg, originates a new
//                  outbound bridged to the agent's softphone.
//               2. Agent talks to the consult target.
//               3. Agent clicks "Complete" → POST /complete with
//                  the two uuids. Server bridges customer ↔
//                  consult target, agent drops out.
//               4. OR Agent clicks "Cancel" → POST /cancel.
//                  Consult leg dies, customer comes off hold.

type Mode = 'blind' | 'attended';

interface ConsultState {
  original_uuid: string;
  consult_uuid: string;
  target: string;
}

export function TransferModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const sp = useSoftphone();
  const [mode, setMode] = useState<Mode>('blind');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consult, setConsult] = useState<ConsultState | null>(null);

  function reset() {
    setTarget('');
    setBusy(false);
    setError(null);
    setConsult(null);
    setMode('blind');
  }

  function dismiss() {
    if (busy) return;
    reset();
    onClose();
  }

  async function blindTransfer() {
    if (!target.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sp.transfer(target.trim());
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'transfer failed');
    } finally {
      setBusy(false);
    }
  }

  async function startConsult() {
    if (!target.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/transfer/consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: target.trim() }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        original_uuid?: string;
        consult_uuid?: string;
        target?: string;
      };
      if (!res.ok || !j.ok || !j.original_uuid || !j.consult_uuid) {
        setError(j.error ?? `consult failed (${res.status})`);
        return;
      }
      setConsult({
        original_uuid: j.original_uuid,
        consult_uuid: j.consult_uuid,
        target: j.target ?? target.trim(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'consult failed');
    } finally {
      setBusy(false);
    }
  }

  async function completeAttended() {
    if (!consult || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/transfer/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_uuid: consult.original_uuid,
          consult_uuid: consult.consult_uuid,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `complete failed (${res.status})`);
        return;
      }
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'complete failed');
    } finally {
      setBusy(false);
    }
  }

  // Iter 120 — third completion path: 3-way conference. All three
  // legs (customer, consult target, agent) end up in a conference
  // room instead of the iter-118 "drop agent + bridge two" flow.
  async function conferenceAttended() {
    if (!consult || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/transfer/conference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_uuid: consult.original_uuid,
          consult_uuid: consult.consult_uuid,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        room?: string;
        partial_failures?: unknown;
      };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `conference failed (${res.status})`);
        return;
      }
      // partial_failures means at least one leg made it but
      // another didn't. Surface a soft warning so the agent
      // knows to verify on their softphone.
      if (j.partial_failures) {
        setError(
          'conference created but one leg failed — verify the call on your softphone',
        );
      }
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'conference failed');
    } finally {
      setBusy(false);
    }
  }

  async function cancelAttended() {
    if (!consult || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/agent/transfer/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_uuid: consult.original_uuid,
          consult_uuid: consult.consult_uuid,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `cancel failed (${res.status})`);
        return;
      }
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'cancel failed');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md p-5 mx-4">
        <header className="mb-3">
          <h2 className="text-lg font-semibold">Transfer call</h2>
          {!consult && (
            <p className="text-fg-subtle text-xs mt-1">
              Blind drops you immediately. Attended lets you talk to the
              target first, then bridges them in.
            </p>
          )}
          {consult && (
            <p className="text-fg-subtle text-xs mt-1">
              You&apos;re consulting with{' '}
              <span className="font-mono text-fg">{consult.target}</span>.
              Customer is on hold.
            </p>
          )}
        </header>

        {!consult && (
          <>
            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">
                Mode
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('blind')}
                  className={`text-xs px-3 py-1.5 rounded border ${
                    mode === 'blind'
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-fg-muted hover:text-fg'
                  }`}
                >
                  Blind
                </button>
                <button
                  type="button"
                  onClick={() => setMode('attended')}
                  className={`text-xs px-3 py-1.5 rounded border ${
                    mode === 'attended'
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-fg-muted hover:text-fg'
                  }`}
                >
                  Attended
                </button>
              </div>
            </div>

            <label className="block mb-3">
              <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">
                Destination
              </div>
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="extension or phone"
                className="input"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && target.trim()) {
                    if (mode === 'blind') void blindTransfer();
                    else void startConsult();
                  }
                }}
              />
            </label>
          </>
        )}

        {error && (
          <p className="text-error text-xs mb-3">{error}</p>
        )}

        <div className="flex items-center justify-end gap-2">
          {!consult && (
            <>
              <button
                type="button"
                onClick={dismiss}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded border border-border text-fg-muted hover:text-fg disabled:opacity-40"
              >
                Cancel
              </button>
              {mode === 'blind' ? (
                <button
                  type="button"
                  onClick={blindTransfer}
                  disabled={!target.trim() || busy}
                  className="text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50"
                >
                  {busy ? 'Transferring…' : 'Transfer'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startConsult}
                  disabled={!target.trim() || busy}
                  className="text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50"
                >
                  {busy ? 'Calling…' : 'Consult'}
                </button>
              )}
            </>
          )}
          {consult && (
            <>
              <button
                type="button"
                onClick={cancelAttended}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded border border-warn/50 text-warn hover:bg-warn/10 disabled:opacity-40"
              >
                {busy ? '…' : 'Cancel & resume'}
              </button>
              <button
                type="button"
                onClick={conferenceAttended}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded border border-info/50 text-info hover:bg-info/10 disabled:opacity-40"
                title="Bring the customer in alongside you and the consult target — all three on the call"
              >
                {busy ? '…' : 'Add to call (3-way)'}
              </button>
              <button
                type="button"
                onClick={completeAttended}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded bg-success hover:bg-success/80 text-white disabled:opacity-50"
              >
                {busy ? 'Bridging…' : 'Complete transfer'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
