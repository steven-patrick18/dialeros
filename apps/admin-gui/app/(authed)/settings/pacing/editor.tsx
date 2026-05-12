'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Step {
  min_rate: number;
  dial_level: number;
}

// Iter 134 — client editor for the pacing-threshold curve.
// Validates step shape locally so the server-side errors are
// the safety net, not the primary feedback channel.

export function PacingThresholdsEditor({
  initial,
  defaults,
}: {
  initial: Step[];
  defaults: Step[];
}) {
  const router = useRouter();
  const [steps, setSteps] = useState<Step[]>(() =>
    initial.map((s) => ({ ...s })),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  function update(i: number, patch: Partial<Step>) {
    setSteps((prev) => {
      const next = [...prev];
      next[i] = { ...next[i]!, ...patch };
      return next;
    });
    setMsg(null);
  }
  function addStep() {
    setSteps((prev) => {
      if (prev.length >= 10) return prev;
      // Insert above the catch-all (min_rate=0) with a rate halfway
      // between the last-but-one and 0.
      const last = prev[prev.length - 1]!;
      const secondLast = prev[prev.length - 2];
      const newRate = secondLast ? (secondLast.min_rate + last.min_rate) / 2 : 0.1;
      return [
        ...prev.slice(0, -1),
        {
          min_rate: Number(newRate.toFixed(3)),
          dial_level: prev[prev.length - 1]!.dial_level + 0.5,
        },
        last,
      ];
    });
  }
  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }

  function validate(s: Step[]): string | null {
    if (s.length < 2) return 'At least 2 steps required.';
    if (s.length > 10) return 'At most 10 steps allowed.';
    const sorted = [...s].sort((a, b) => b.min_rate - a.min_rate);
    if (JSON.stringify(sorted) !== JSON.stringify(s)) {
      return 'Steps must be sorted DESC by min_rate.';
    }
    for (let i = 1; i < s.length; i++) {
      if (s[i]!.min_rate >= s[i - 1]!.min_rate) {
        return `Row ${i + 1}: min_rate must be strictly lower than row ${i}.`;
      }
    }
    if (s[s.length - 1]!.min_rate !== 0) {
      return 'Lowest step must be min_rate = 0 (catch-all).';
    }
    for (const step of s) {
      if (step.dial_level <= 0 || step.dial_level >= 100) {
        return 'dial_level must be > 0 and < 100.';
      }
      if (step.min_rate < 0 || step.min_rate > 1) {
        return 'min_rate must be between 0 and 1.';
      }
    }
    return null;
  }

  async function save() {
    const err = validate(steps);
    if (err) {
      setMsg({ tone: 'err', text: err });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/settings/pacing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || (j.ok !== undefined && !j.ok)) {
        setMsg({ tone: 'err', text: j.error ?? `save failed (${res.status})` });
        return;
      }
      setMsg({ tone: 'ok', text: 'Saved. Recommendations will use the new curve immediately.' });
      router.refresh();
    } catch (e) {
      setMsg({
        tone: 'err',
        text: e instanceof Error ? e.message : 'save failed',
      });
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!confirm('Revert to default thresholds? Custom curve will be discarded.')) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/settings/pacing', { method: 'DELETE' });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || (j.ok !== undefined && !j.ok)) {
        setMsg({ tone: 'err', text: j.error ?? `reset failed (${res.status})` });
        return;
      }
      setSteps(defaults.map((s) => ({ ...s })));
      setMsg({ tone: 'ok', text: 'Reverted to defaults.' });
      router.refresh();
    } catch (e) {
      setMsg({
        tone: 'err',
        text: e instanceof Error ? e.message : 'reset failed',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <table className="w-full text-sm mb-3 border border-border rounded overflow-hidden">
        <thead className="bg-card-hover/30 text-fg-subtle text-left">
          <tr>
            <th className="px-3 py-2 font-medium text-[10px] uppercase tracking-wide">
              Step
            </th>
            <th className="px-3 py-2 font-medium text-[10px] uppercase tracking-wide">
              Min answer rate (%)
            </th>
            <th className="px-3 py-2 font-medium text-[10px] uppercase tracking-wide">
              dial_level
            </th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => {
            const isCatchAll = i === steps.length - 1;
            return (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2 text-fg-subtle font-mono">
                  {i + 1}
                  {isCatchAll && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-fg-subtle">
                      catch-all
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={(s.min_rate * 100).toFixed(1)}
                    disabled={isCatchAll}
                    onChange={(e) =>
                      update(i, {
                        min_rate:
                          Math.max(0, Math.min(100, Number(e.target.value))) /
                          100,
                      })
                    }
                    className="input w-24 disabled:opacity-60"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="0.1"
                    max="99"
                    step="0.1"
                    value={s.dial_level}
                    onChange={(e) =>
                      update(i, { dial_level: Number(e.target.value) })
                    }
                    className="input w-24"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  {!isCatchAll && steps.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeStep(i)}
                      className="text-xs text-error hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex items-center justify-between gap-3 mb-4">
        <button
          type="button"
          onClick={addStep}
          disabled={busy || steps.length >= 10}
          className="text-xs px-3 py-1 rounded border border-border text-fg-muted hover:text-fg hover:bg-card-hover/40 disabled:opacity-50"
        >
          + Add step
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="text-xs px-3 py-1 rounded border border-warn/40 text-warn hover:bg-warn/10 disabled:opacity-40"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save curve'}
          </button>
        </div>
      </div>

      {msg && (
        <p
          className={`text-xs ${
            msg.tone === 'ok' ? 'text-success' : 'text-error'
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
