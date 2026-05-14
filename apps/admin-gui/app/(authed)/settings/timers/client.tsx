'use client';

import { useEffect, useState } from 'react';

interface TimerInfo {
  timer_unit: string;
  service_unit: string;
  active: boolean;
  next_run_iso: string | null;
  last_run_iso: string | null;
  next_run_relative: string | null;
  last_run_relative: string | null;
  description: string | null;
  service_result: string | null;
  service_exit_code: number | null;
  service_active_state: string | null;
}

const POLL_MS = 15_000;

export function TimersClient() {
  const [timers, setTimers] = useState<TimerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/settings/timers', {
          credentials: 'same-origin',
        });
        if (!res.ok) {
          if (!cancelled) setError(`API ${res.status}`);
          return;
        }
        const data = (await res.json()) as { timers: TimerInfo[] };
        if (!cancelled) {
          setTimers(data.timers);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const h = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(h);
    };
  }, []);

  function statusBadge(t: TimerInfo) {
    if (t.service_result && t.service_result !== 'success') {
      return (
        <span className="text-error font-semibold">
          ✕ {t.service_result}
          {t.service_exit_code != null && t.service_exit_code !== 0
            ? ` (exit ${t.service_exit_code})`
            : ''}
        </span>
      );
    }
    if (!t.last_run_iso) {
      return <span className="text-fg-subtle">— pending</span>;
    }
    return <span className="text-success">● OK</span>;
  }

  async function copyJournalCmd(serviceUnit: string) {
    const cmd = `sudo journalctl -u ${serviceUnit} -n 50 --no-pager`;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(serviceUnit);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard may be blocked in some browsers; ignore */
    }
  }

  if (loading) {
    return <p className="text-fg-subtle text-sm">Loading…</p>;
  }
  if (error) {
    return <p className="text-error text-sm">{error}</p>;
  }
  if (timers.length === 0) {
    return (
      <p className="text-fg-subtle text-sm">
        No <code>dialeros-*.timer</code> units installed. Install
        the systemd units from <code>infra/systemd/</code> first.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto border border-border rounded-md">
      <table className="w-full text-sm">
        <thead className="bg-bg-elevated text-fg-subtle text-left text-xs uppercase tracking-wide">
          <tr>
            <th className="px-3 py-2">Timer</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Last run</th>
            <th className="px-3 py-2">Next run</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {timers.map((t) => (
            <tr key={t.timer_unit} className="border-t border-border align-top">
              <td className="px-3 py-2">
                <div className="font-mono text-xs">{t.timer_unit}</div>
                {t.description ? (
                  <div className="text-xs text-fg-subtle">
                    {t.description}
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{statusBadge(t)}</td>
              <td className="px-3 py-2 text-xs">
                {t.last_run_iso ? (
                  <>
                    <div>{new Date(t.last_run_iso).toLocaleString()}</div>
                    {t.last_run_relative ? (
                      <div className="text-fg-subtle">
                        {t.last_run_relative}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-xs">
                {t.next_run_iso ? (
                  <>
                    <div>{new Date(t.next_run_iso).toLocaleString()}</div>
                    {t.next_run_relative ? (
                      <div className="text-fg-subtle">
                        in {t.next_run_relative}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-xs whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => copyJournalCmd(t.service_unit)}
                  className="text-link hover:underline"
                  title="Copy journalctl command for this service"
                >
                  {copied === t.service_unit ? '✓ copied' : '⎘ journalctl'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
