'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';

// Iter 142 — Floor call-history table + filter form. Client
// component so the form can re-query the API on change without a
// full nav. Plays recordings inline via the iter-55 streaming
// endpoint.
//
// Filter state mirrors the search-params accepted by
// /api/supervisor/calls — empty fields are omitted so the URL
// stays clean and the server treats them as "no filter".

interface Row {
  id: number;
  ts: string;
  campaign_id: string;
  campaign_name: string | null;
  lead_id: string;
  lead_phone: string;
  lead_name: string | null;
  transformed_phone: string;
  kind: string;
  assigned_user_id: string | null;
  assigned_username: string | null;
  answered_at: string | null;
  hangup_at: string | null;
  hangup_cause: string | null;
  duration_ms: number | null;
  disposition: string | null;
  amd_result: string | null;
  recording_path: string | null;
  originate_error: string | null;
}

interface CampaignOption {
  id: string;
  name: string;
}
interface AgentOption {
  id: string;
  username: string;
  display_name: string | null;
}

interface Props {
  initialRows: Row[];
  campaigns: CampaignOption[];
  agents: AgentOption[];
  defaultSinceIso: string;
}

// AMD verdicts produced by amd_v2 + the empty-string fallthrough
// the dialplan logs when the app exited without setting one.
const AMD_OPTIONS = ['', 'HUMAN', 'MACHINE', 'NOTSURE', 'UNKNOWN'];

function isoToLocalInput(iso: string): string {
  // Convert ISO -> <input type="datetime-local"> friendly slice.
  // The input wants YYYY-MM-DDTHH:mm (no seconds, no Z) in local
  // time — so we re-format from the Date's local fields.
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string {
  if (!local) return '';
  return new Date(local).toISOString();
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`;
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r.toString().padStart(2, '0')}s`;
}

export function CallsList({
  initialRows,
  campaigns,
  agents,
  defaultSinceIso,
}: Props) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [since, setSince] = useState<string>(
    isoToLocalInput(defaultSinceIso),
  );
  const [until, setUntil] = useState<string>('');
  const [campaignId, setCampaignId] = useState<string>('');
  const [agentId, setAgentId] = useState<string>('');
  const [disposition, setDisposition] = useState<string>('');
  const [amdResult, setAmdResult] = useState<string>('');
  const [onlyWithRecording, setOnlyWithRecording] =
    useState<boolean>(false);
  const [limit, setLimit] = useState<number>(200);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Build unique disposition list from the loaded rows. Cheaper than
  // a separate /api/dispositions round-trip and the filter dropdown
  // only needs to reflect dispositions actually in use.
  const dispositionOptions = Array.from(
    new Set(
      rows
        .map((r) => r.disposition)
        .filter((d): d is string => Boolean(d)),
    ),
  ).sort();

  async function refetch() {
    setError(null);
    const params = new URLSearchParams();
    if (since) params.set('since', localInputToIso(since));
    if (until) params.set('until', localInputToIso(until));
    if (campaignId) params.set('campaign_id', campaignId);
    if (agentId) params.set('agent_id', agentId);
    if (disposition) params.set('disposition', disposition);
    if (amdResult) params.set('amd_result', amdResult);
    if (onlyWithRecording) params.set('only_with_recording', '1');
    params.set('limit', String(limit));
    try {
      const res = await fetch(
        `/api/supervisor/calls?${params.toString()}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) {
        setError(`API ${res.status}: ${await res.text()}`);
        return;
      }
      const data = (await res.json()) as { rows: Row[] };
      setRows(data.rows);
      // Stop any active playback when filters change so the
      // <audio> element doesn't keep streaming a row that's no
      // longer visible.
      setPlayingId(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Auto-refetch on filter change with a tiny debounce so dragging
  // the datetime spinner doesn't hammer the API.
  useEffect(() => {
    const t = setTimeout(() => {
      startTransition(() => {
        void refetch();
      });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    since,
    until,
    campaignId,
    agentId,
    disposition,
    amdResult,
    onlyWithRecording,
    limit,
  ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4 rounded-md border border-border bg-bg-elevated">
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Since</span>
          <input
            type="datetime-local"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="input"
          />
        </label>
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Until (optional)</span>
          <input
            type="datetime-local"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="input"
          />
        </label>
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Campaign</span>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="input"
          >
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Agent</span>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="input"
          >
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name
                  ? `${a.display_name} (${a.username})`
                  : a.username}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Disposition</span>
          <select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value)}
            className="input"
          >
            <option value="">Any disposition</option>
            {dispositionOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">AMD result</span>
          <select
            value={amdResult}
            onChange={(e) => setAmdResult(e.target.value)}
            className="input"
          >
            {AMD_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v ? v : 'Any AMD result'}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Row limit</span>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="input"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500 (max)</option>
          </select>
        </label>
        <label className="text-sm flex items-center gap-2 mt-5">
          <input
            type="checkbox"
            checked={onlyWithRecording}
            onChange={(e) => setOnlyWithRecording(e.target.checked)}
          />
          <span>Only rows with a recording</span>
        </label>
      </div>

      {error ? (
        <div className="text-sm text-error">{error}</div>
      ) : null}

      <div className="text-sm text-fg-subtle">
        {isPending
          ? 'Refreshing…'
          : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
      </div>

      <div className="overflow-x-auto border border-border rounded-md">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated text-fg-subtle">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Campaign</th>
              <th className="px-3 py-2 text-left">Agent</th>
              <th className="px-3 py-2 text-left">Phone</th>
              <th className="px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-left">AMD</th>
              <th className="px-3 py-2 text-left">Hangup</th>
              <th className="px-3 py-2 text-left">Duration</th>
              <th className="px-3 py-2 text-left">Disposition</th>
              <th className="px-3 py-2 text-left">Recording</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-6 text-center text-fg-subtle"
                >
                  No calls match this filter set.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-border align-top"
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link
                      href={`/calls/${r.id}`}
                      className="text-link hover:underline"
                    >
                      {fmtTime(r.ts)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {r.campaign_name ?? r.campaign_id}
                  </td>
                  <td className="px-3 py-2">
                    {r.assigned_username ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <a
                      className="text-link hover:underline"
                      href={`/leads/lead/${r.lead_id}`}
                    >
                      {r.lead_phone}
                    </a>
                  </td>
                  <td className="px-3 py-2">{r.kind}</td>
                  <td className="px-3 py-2">{r.amd_result ?? '—'}</td>
                  <td className="px-3 py-2">
                    {r.hangup_cause ?? '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {fmtDuration(r.duration_ms)}
                  </td>
                  <td className="px-3 py-2">
                    {r.disposition ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    {r.recording_path ? (
                      playingId === r.id ? (
                        <div className="flex flex-col gap-1">
                          <audio
                            controls
                            autoPlay
                            src={`/api/recordings/${r.id}`}
                            className="h-8 w-64"
                          />
                          <button
                            type="button"
                            className="text-xs text-fg-subtle hover:text-fg underline self-start"
                            onClick={() => setPlayingId(null)}
                          >
                            close
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => setPlayingId(r.id)}
                        >
                          ▶ play
                        </button>
                      )
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
