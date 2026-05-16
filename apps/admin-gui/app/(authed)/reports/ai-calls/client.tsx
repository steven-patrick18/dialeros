'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';

interface Session {
  id: string;
  persona_id: string;
  call_uuid: string | null;
  from_phone: string | null;
  status: string;
  turn_count: number;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  qa_score: number | null;
  qa_summary: string | null;
  qa_flags: string | null;
}
interface AbStat {
  persona_id: string;
  count: number;
  completed_pct: number;
  escalated_pct: number;
  avg_turns: number;
  avg_qa: number | null;
  graded: number;
}
interface Turn {
  id: number;
  turn_index: number;
  role: string;
  text: string;
  stt_ms: number | null;
  llm_ms: number | null;
  tts_ms: number | null;
  created_at: string;
}

function statusTone(s: string): string {
  if (s === 'completed') return 'text-success';
  if (s === 'escalated') return 'text-warn';
  if (s === 'aborted') return 'text-error';
  return 'text-info';
}

export function AiCallsClient() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [ab, setAb] = useState<AbStat[]>([]);
  const [live, setLive] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/reports/ai-calls', {
        credentials: 'same-origin',
      });
      if (!r.ok) {
        setErr(`HTTP ${r.status}`);
        return;
      }
      const j = (await r.json()) as {
        live_enabled: boolean;
        sessions: Session[];
        ab_summary?: AbStat[];
      };
      setLive(j.live_enabled);
      setSessions(j.sessions);
      setAb(j.ab_summary ?? []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  async function toggleLive(next: boolean) {
    setBusy(true);
    try {
      const r = await fetch('/api/settings/ai-live', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ enabled: next }),
      });
      if (r.ok) {
        const j = (await r.json()) as { live_enabled: boolean };
        setLive(j.live_enabled);
      }
    } finally {
      setBusy(false);
    }
  }

  async function openSession(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setTurns([]);
    const r = await fetch(`/api/reports/ai-calls/${id}`, {
      credentials: 'same-origin',
    });
    if (r.ok) {
      const j = (await r.json()) as { turns: Turn[] };
      setTurns(j.turns);
    }
  }

  return (
    <div className="space-y-4">
      <div
        className={
          live
            ? 'border border-warn/50 bg-warn/10 rounded p-4'
            : 'border border-border rounded p-4 bg-card'
        }
      >
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={live}
            disabled={busy}
            onChange={(e) => void toggleLive(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm">
            <strong>Live AI calls {live ? 'ENABLED' : 'disabled'}</strong>
            <span className="block text-xs text-fg-subtle mt-0.5">
              Master gate. Requires mod_audio_stream compiled
              (scripts/install-audio-fork.sh) — enabling it
              without the module means persona-bound calls answer
              then park silently. Keep OFF until the module is
              installed + a persona is tested in the sandbox.
            </span>
          </span>
        </label>
      </div>

      {err && <p className="text-error text-xs">{err}</p>}

      {ab.length > 1 && (
        <div className="border border-border rounded p-4">
          <h2 className="text-sm font-semibold mb-2">
            A/B by persona
          </h2>
          <table className="w-full text-xs">
            <thead className="text-left text-fg-subtle">
              <tr>
                <th className="py-1">Persona</th>
                <th>Calls</th>
                <th>Completed</th>
                <th>Escalated</th>
                <th>Avg turns</th>
                <th>Avg QA</th>
              </tr>
            </thead>
            <tbody>
              {ab.map((v) => (
                <tr
                  key={v.persona_id}
                  className="border-t border-border/40"
                >
                  <td className="py-1 font-mono">{v.persona_id}</td>
                  <td className="tabular-nums">{v.count}</td>
                  <td className="tabular-nums">{v.completed_pct}%</td>
                  <td className="tabular-nums">{v.escalated_pct}%</td>
                  <td className="tabular-nums">{v.avg_turns}</td>
                  <td className="tabular-nums">
                    {v.avg_qa == null ? '\u2014' : v.avg_qa}
                    {v.graded > 0 && (
                      <span className="text-fg-subtle">
                        {' '}
                        (n={v.graded})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="text-sm text-fg-subtle">
          No AI calls recorded yet.
        </p>
      ) : (
        <table className="w-full text-sm border border-border rounded">
          <thead className="bg-card">
            <tr className="text-left">
              <th className="px-3 py-2">Started</th>
              <th className="px-3 py-2">From</th>
              <th className="px-3 py-2">Persona</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Turns</th>
              <th className="px-3 py-2">QA</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <Fragment key={s.id}>
                <tr className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">
                    {new Date(s.started_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {s.from_phone ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {s.persona_id}
                  </td>
                  <td className={`px-3 py-2 text-xs ${statusTone(s.status)}`}>
                    {s.status}
                    {s.end_reason && (
                      <span className="text-fg-subtle">
                        {' '}
                        ({s.end_reason})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {s.turn_count}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {s.qa_score == null ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      <span
                        title={s.qa_summary ?? undefined}
                        className={
                          s.qa_score >= 70
                            ? 'text-success'
                            : s.qa_score >= 40
                              ? 'text-warn'
                              : 'text-error'
                        }
                      >
                        {s.qa_score}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void openSession(s.id)}
                      className="text-link hover:underline text-xs"
                    >
                      {openId === s.id ? 'Hide' : 'Transcript'}
                    </button>
                  </td>
                </tr>
                {openId === s.id && (
                  <tr>
                    <td colSpan={7} className="px-3 py-2 bg-card/50">
                      {turns.length === 0 ? (
                        <span className="text-xs text-fg-subtle">
                          Loading transcript…
                        </span>
                      ) : (
                        <div className="space-y-1">
                          {turns.map((t) => (
                            <div key={t.id} className="text-xs">
                              <span
                                className={
                                  t.role === 'ai'
                                    ? 'text-accent'
                                    : 'text-fg'
                                }
                              >
                                <strong>
                                  {t.role === 'ai' ? 'AI' : 'Caller'}:
                                </strong>{' '}
                                {t.text}
                              </span>
                              <span className="text-fg-subtle ml-2">
                                {t.stt_ms != null &&
                                  `stt ${t.stt_ms}ms `}
                                {t.llm_ms != null &&
                                  `llm ${t.llm_ms}ms `}
                                {t.tts_ms != null &&
                                  `tts ${t.tts_ms}ms`}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
