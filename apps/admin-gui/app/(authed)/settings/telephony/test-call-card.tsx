'use client';

import { useEffect, useRef, useState } from 'react';

interface CarrierOption {
  id: string;
  name: string;
  enabled: boolean;
}

type App = 'echo' | 'playback' | 'park' | 'amd-detect';

const APP_HINT: Record<App, string> = {
  echo: 'After answer, FreeSWITCH echoes whatever the called party says back. Best for confirming 2-way audio.',
  playback:
    'After answer, FreeSWITCH plays a 2-second 440/480 Hz tone loop. Use when the called party can\'t speak back.',
  park: 'After answer, the call sits parked silent until you hit Hangup. Use for "did the carrier connect at all" tests.',
  'amd-detect':
    'After answer, FreeSWITCH listens for ~3 seconds and decides HUMAN vs MACHINE vs UNSURE. Result shows in the call panel below. Call hangs up automatically once AMD decides — no agent audio.',
};

interface PlaceResult {
  ok: boolean;
  uuid?: string;
  gateway?: string;
  to?: string;
  cid?: string | null;
  app?: App;
  error?: string;
  code?: string;
}

interface LiveStatus {
  exists: boolean;
  state?: string | null;
  call_state?: string | null;
  answered?: boolean;
  duration_ms?: number;
  destination?: string | null;
  cid_number?: string | null;
  amd_result?: string | null;
  amd_cause?: string | null;
}

export function TestCallCard({ carriers }: { carriers: CarrierOption[] }) {
  const [carrierId, setCarrierId] = useState(
    carriers.find((c) => c.enabled)?.id ?? carriers[0]?.id ?? '',
  );
  const [to, setTo] = useState('');
  const [cid, setCid] = useState('');
  const [app, setApp] = useState<App>('echo');
  const [timeoutSec, setTimeoutSec] = useState(30);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PlaceResult | null>(null);

  // Live-call panel state — one active test call at a time.
  const [activeUuid, setActiveUuid] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [snapshot, setSnapshot] = useState<LiveStatus | null>(null);
  const [hangupBusy, setHangupBusy] = useState(false);
  const tickerRef = useRef<NodeJS.Timeout | null>(null);

  async function place() {
    if (!carrierId || !to.trim()) {
      setResult({ ok: false, error: 'Pick a carrier and enter a destination.' });
      return;
    }
    setBusy(true);
    setResult(null);
    setActiveUuid(null);
    setStatus(null);
    setSnapshot(null);
    try {
      const res = await fetch('/api/telephony/test-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier_id: carrierId,
          to: to.trim(),
          cid: cid.trim() || undefined,
          app,
          timeout_seconds: timeoutSec,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as PlaceResult & {
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setResult({
          ok: false,
          error: j.error ?? `request failed (${res.status})`,
          code: j.code,
        });
        return;
      }
      setResult(j);
      if (j.uuid) {
        setActiveUuid(j.uuid);
      }
    } finally {
      setBusy(false);
    }
  }

  async function hangup() {
    if (!activeUuid) return;
    setHangupBusy(true);
    try {
      await fetch(`/api/telephony/calls/${activeUuid}`, { method: 'DELETE' });
    } finally {
      setHangupBusy(false);
    }
  }

  // Poll status for the active call.
  useEffect(() => {
    if (!activeUuid) return;
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch(
          `/api/telephony/calls/${activeUuid}`,
          { cache: 'no-store' },
        );
        if (cancelled) return;
        const j = (await res.json().catch(() => ({}))) as LiveStatus;
        setStatus(j);
        if (j.exists) {
          // Snapshot the latest live data so we can show it after hangup.
          setSnapshot(j);
        } else {
          // Channel is gone — stop polling.
          if (tickerRef.current) {
            clearInterval(tickerRef.current);
            tickerRef.current = null;
          }
        }
      } catch {
        /* transient — keep polling */
      }
    }
    tick();
    tickerRef.current = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      if (tickerRef.current) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
    };
  }, [activeUuid]);

  return (
    <div className="border border-border rounded p-4">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
        Test call
      </h2>
      <p className="text-xs text-fg-subtle mb-3">
        Place a one-shot call through a carrier&apos;s pushed FreeSWITCH
        gateway. The carrier must be in <span className="font-mono">UP</span>{' '}
        state on its detail page first &mdash; otherwise the originate fails
        before reaching the far end.
      </p>

      {carriers.length === 0 ? (
        <p className="text-fg-subtle text-sm">
          No carriers configured yet. Add one under Carriers &rarr; New.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <Field label="Carrier" hint="Which gateway to send the INVITE through.">
            <select
              value={carrierId}
              onChange={(e) => setCarrierId(e.target.value)}
              className="input text-sm"
            >
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.enabled ? '' : ' (disabled)'}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="To (E.164 or digits)"
            hint="Destination number. Dialed verbatim — no route-plan transforms apply here."
          >
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="+14155551234"
              className="input text-sm font-mono"
              autoComplete="off"
            />
          </Field>

          <Field
            label="CID (recommended)"
            hint="Outbound caller-ID. Lands in the SIP From: header. Leave blank and your carrier will see 'FreeSWITCH' as the caller."
          >
            <input
              value={cid}
              onChange={(e) => setCid(e.target.value)}
              placeholder="+12025550100"
              className="input text-sm font-mono"
              autoComplete="off"
            />
          </Field>

          <Field label="App after answer" hint={APP_HINT[app]}>
            <select
              value={app}
              onChange={(e) => setApp(e.target.value as App)}
              className="input text-sm"
            >
              <option value="echo">echo &mdash; test 2-way audio</option>
              <option value="playback">playback &mdash; 440/480 Hz tone</option>
              <option value="park">park &mdash; silent (manual hangup)</option>
              <option value="amd-detect">
                amd-detect &mdash; HUMAN vs MACHINE
              </option>
            </select>
          </Field>

          <Field
            label="Originate timeout"
            hint="How long FreeSWITCH waits for the far end to answer."
          >
            <input
              type="number"
              value={timeoutSec}
              onChange={(e) => setTimeoutSec(Math.max(5, Math.min(120, Number(e.target.value) || 30)))}
              min={5}
              max={120}
              className="input text-sm w-32 tabular-nums"
            />
          </Field>
        </div>
      )}

      {carriers.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={place}
            disabled={busy || !!activeUuid}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-40"
          >
            {busy
              ? 'Placing call…'
              : activeUuid
                ? 'Call active — hang up first'
                : 'Place test call'}
          </button>
          {!activeUuid && (
            <span className="text-xs text-fg-subtle">
              Synchronous &mdash; the request blocks until the leg connects or fails.
            </span>
          )}
        </div>
      )}

      {result && !result.ok && (
        <div className="mt-3 rounded border p-3 text-sm border-error/50 bg-error/10 text-error">
          ✗ {result.error}
          {result.code && (
            <div className="text-xs text-fg-subtle mt-1">
              Code: <span className="font-mono">{result.code}</span>
            </div>
          )}
        </div>
      )}

      {activeUuid && (
        <LiveCallPanel
          uuid={activeUuid}
          status={status}
          snapshot={snapshot}
          gateway={result?.gateway}
          destination={result?.to}
          cid={result?.cid ?? null}
          app={result?.app}
          onHangup={hangup}
          hangupBusy={hangupBusy}
          onClose={() => {
            setActiveUuid(null);
            setStatus(null);
            setSnapshot(null);
            setResult(null);
          }}
        />
      )}
    </div>
  );
}

function LiveCallPanel({
  uuid,
  status,
  snapshot,
  gateway,
  destination,
  cid,
  app,
  onHangup,
  hangupBusy,
  onClose,
}: {
  uuid: string;
  status: LiveStatus | null;
  snapshot: LiveStatus | null;
  gateway: string | undefined;
  destination: string | undefined;
  cid: string | null;
  app: App | undefined;
  onHangup: () => void;
  hangupBusy: boolean;
  onClose: () => void;
}) {
  const isLive = status?.exists ?? false;
  const final = isLive ? null : snapshot;
  const stateText = stateLabel(status, snapshot);
  const stateColor = stateColorFor(status, snapshot);
  const display = status?.exists ? status : (final ?? snapshot ?? status);
  const amdResult = display?.amd_result ?? null;
  const durationMs = display?.duration_ms ?? 0;

  return (
    <div className="mt-4 rounded-lg border border-border bg-card/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span
            className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded border ${stateColor}`}
          >
            {stateText}
          </span>
          <span className="text-xs text-fg-subtle font-mono">
            {uuid.slice(0, 8)}…
          </span>
        </div>
        <DurationCounter ms={durationMs} ticking={isLive} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
        <KV
          label="To"
          value={
            <span className="font-mono">
              {destination ?? display?.destination ?? '—'}
            </span>
          }
        />
        <KV
          label="From (CID)"
          value={
            <span className="font-mono">
              {cid ?? display?.cid_number ?? '—'}
            </span>
          }
        />
        <KV label="App" value={<span className="font-mono">{app ?? '—'}</span>} />
        <KV
          label="Gateway"
          value={
            <span className="font-mono truncate" title={gateway}>
              {gateway ? gateway.replace(/^dialeros-/, '') : '—'}
            </span>
          }
        />
      </div>

      {amdResult && (
        <div
          className={`text-sm rounded border p-3 mb-3 ${
            amdResult === 'HUMAN'
              ? 'border-success/40 bg-success/10 text-success'
              : amdResult === 'MACHINE'
                ? 'border-warn/40 bg-warn/10 text-warn'
                : 'border-border bg-card/40 text-fg-muted'
          }`}
        >
          AMD result: <span className="font-mono">{amdResult}</span>
          {display?.amd_cause && (
            <span className="text-fg-subtle text-xs ml-2">
              ({display.amd_cause})
            </span>
          )}
        </div>
      )}

      {/* Future-softphone control row — wires up next iter */}
      <div className="flex items-center gap-2 mb-3">
        <ControlButton disabled label="Mute" hint="Browser audio + sip.js arrives in iter 35b" />
        <ControlButton disabled label="DTMF" hint="Dialpad — iter 35b" />
        <ControlButton disabled label="Speaker" hint="Volume control — iter 35b" />
        <ControlButton disabled label="Hold" hint="Hold/resume — iter 35b" />
      </div>

      <div className="flex items-center gap-3">
        {isLive ? (
          <button
            type="button"
            onClick={onHangup}
            disabled={hangupBusy}
            className="bg-error hover:bg-error/90 text-white px-4 py-2 rounded text-sm disabled:opacity-40"
          >
            {hangupBusy ? 'Hanging up…' : 'Hang up'}
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="bg-card-hover hover:bg-card-hover/70 text-fg px-4 py-2 rounded text-sm"
          >
            Close
          </button>
        )}
        <span className="text-xs text-fg-subtle">
          {isLive
            ? 'Polling status every 1.5s.'
            : 'Call ended.'}
        </span>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  hint,
  disabled,
}: {
  label: string;
  hint: string;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={hint}
      className="text-xs px-3 py-1.5 rounded border border-border text-fg-muted bg-card-hover/30 cursor-not-allowed"
    >
      {label}
    </button>
  );
}

function DurationCounter({ ms, ticking }: { ms: number; ticking: boolean }) {
  // When the channel is still alive, we re-render on each poll (every
  // 1.5s) — that's fine for a counter. No separate ticker needed.
  void ticking;
  const sec = Math.max(0, Math.round(ms / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return (
    <span className="text-2xl tabular-nums text-fg font-mono">
      {mm}:{ss}
    </span>
  );
}

function stateLabel(
  status: LiveStatus | null,
  snapshot: LiveStatus | null,
): string {
  if (!status && !snapshot) return 'Connecting';
  if (status?.exists) {
    if (status.answered) return 'Answered';
    return 'Ringing';
  }
  return 'Ended';
}

function stateColorFor(
  status: LiveStatus | null,
  snapshot: LiveStatus | null,
): string {
  if (!status && !snapshot) return 'bg-warn/15 text-warn border-warn/40';
  if (status?.exists) {
    if (status.answered) {
      return 'bg-success/15 text-success border-success/40';
    }
    return 'bg-warn/15 text-warn border-warn/40';
  }
  return 'bg-fg-subtle/15 text-fg-muted border-border';
}

function KV({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase text-fg-subtle">{label}</div>
      <div className="mt-0.5 truncate">{value}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs text-fg-subtle mb-1 flex items-center gap-2">
        <span>{label}</span>
        <span
          className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-border text-[10px] text-fg-muted hover:text-fg hover:border-fg-muted cursor-help"
          title={hint}
          aria-label={hint}
        >
          ?
        </span>
      </div>
      {children}
    </label>
  );
}
