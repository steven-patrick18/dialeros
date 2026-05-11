'use client';

import { useEffect, useRef, useState } from 'react';
import { useSoftphone } from '@/components/softphone';

// Iter 39 — eyeBeam-style softphone for the agent console.
// Iter 40 — pause/resume + manual-dial mode for expert users.
// Iter 47 — caller-ID override on manual dial; Hold + blind Transfer
// action keys; manual dial works while PAUSED (pause means "don't
// auto-bridge me", not "lock me out of placing calls").

const KEYPAD: Array<{ digit: string; letters?: string }> = [
  { digit: '1' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*' },
  { digit: '0', letters: '+' },
  { digit: '#' },
];

type AgentStatus = 'AVAILABLE' | 'PAUSED';

interface HistoryEntry {
  destination: string;
  cid: string | null;
  ts: number;
}

const HISTORY_KEY = 'dialeros_dial_history';
const HISTORY_MAX = 10;

function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    window.localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(entries.slice(0, HISTORY_MAX)),
    );
  } catch {
    /* quota exceeded / disabled — silently ignore */
  }
}

export function AgentSoftphonePanel() {
  const sp = useSoftphone();
  const [elapsed, setElapsed] = useState(0);
  const [now, setNow] = useState<string>(formatClock(new Date()));
  const startedAt = useRef<number | null>(null);

  const [status, setStatus] = useState<AgentStatus>('AVAILABLE');
  const [statusBusy, setStatusBusy] = useState(false);

  const [manualDial, setManualDial] = useState(false);
  const [buffer, setBuffer] = useState('');
  const [cid, setCid] = useState('');
  const [dialBusy, setDialBusy] = useState(false);
  const [dialMsg, setDialMsg] = useState<string | null>(null);
  /** Iter 95 — correlation_id from the last manual dial. Polled
   * against /api/agent/call-status every 3 s while sp.inCall is
   * true; if the server reports hangup_at set but the softphone
   * still thinks it's connected, force-clear the UI. Fixes the
   * "stuck connected after carrier hung up" sip.js BYE-miss
   * problem. */
  const [activeCorrelationId, setActiveCorrelationId] = useState<
    string | null
  >(null);

  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());

  useEffect(() => {
    let cancelled = false;
    fetch('/api/telephony/softphone-config', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ manual_dial: boolean }>) : null))
      .then((cfg) => {
        if (!cancelled && cfg) setManualDial(!!cfg.manual_dial);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/agent/status', { cache: 'no-store' })
      .then((r) =>
        r.ok ? (r.json() as Promise<{ status: AgentStatus }>) : null,
      )
      .then((s) => {
        if (!cancelled && s) setStatus(s.status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!sp.inCall) {
      startedAt.current = null;
      setElapsed(0);
      return;
    }
    if (startedAt.current === null) {
      startedAt.current = Date.now();
      setElapsed(0);
    }
    const id = setInterval(() => {
      setElapsed(
        Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000),
      );
    }, 1000);
    return () => clearInterval(id);
  }, [sp.inCall]);

  // Iter 95 — BYE-miss watchdog. While the softphone thinks we're
  // in a call AND we have a correlation_id from the manual dial,
  // poll /api/agent/call-status every 3 s. If the server says the
  // dial_intent is hung_up but the softphone still believes it's
  // connected, sip.js missed the BYE. forceClear() unsticks the
  // UI. Cleared on natural hangup (when activeCorrelationId is
  // reset below).
  useEffect(() => {
    if (!sp.inCall || !activeCorrelationId) return;
    let cancelled = false;
    let consecutiveHungUp = 0;
    async function tick() {
      try {
        const res = await fetch(
          `/api/agent/call-status?correlation_id=${encodeURIComponent(activeCorrelationId!)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const j = (await res.json()) as {
          hung_up?: boolean;
          unknown?: boolean;
          cause?: string;
        };
        if (cancelled) return;
        if (j.hung_up) {
          // Two consecutive hung_up:true responses before clearing
          // — a tiny dead-band against the very narrow race where
          // sip.js is mid-BYE-processing.
          consecutiveHungUp++;
          if (consecutiveHungUp >= 2) {
            setDialMsg(
              `hung up: ${j.cause ?? 'remote'} (sip.js missed the BYE — force-cleared)`,
            );
            await sp.forceClear();
            setActiveCorrelationId(null);
          }
        } else {
          consecutiveHungUp = 0;
        }
      } catch {
        /* network blip — keep trying */
      }
    }
    const handle = setInterval(tick, 3000);
    // Don't fire immediately — sip.js usually processes BYE in
    // <100ms; only kick in if the call's still showing after 3 s.
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [sp.inCall, activeCorrelationId, sp]);

  // Iter 95 — once sp.inCall flips back to false (natural hangup
  // path), drop the correlation_id so the next dial starts fresh.
  useEffect(() => {
    if (!sp.inCall && activeCorrelationId) {
      setActiveCorrelationId(null);
    }
  }, [sp.inCall, activeCorrelationId]);

  // Iter 46 — wrap-up overlay flips status to PAUSED while disposing.
  // Refresh local state on focus / visibility change so the panel
  // reflects what /agent/status actually says (debounced via the
  // visibility event so we don't poll constantly).
  useEffect(() => {
    function refresh() {
      fetch('/api/agent/status', { cache: 'no-store' })
        .then((r) =>
          r.ok ? (r.json() as Promise<{ status: AgentStatus }>) : null,
        )
        .then((s) => s && setStatus(s.status))
        .catch(() => {});
    }
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);

  async function togglePause() {
    if (statusBusy) return;
    setStatusBusy(true);
    const next: AgentStatus = status === 'PAUSED' ? 'AVAILABLE' : 'PAUSED';
    try {
      const res = await fetch('/api/agent/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        const j = (await res.json()) as { status: AgentStatus };
        setStatus(j.status);
      }
    } finally {
      setStatusBusy(false);
    }
  }

  async function placeCallTo(destination: string, cidOverride: string | null) {
    if (!destination || sp.inCall || dialBusy) return;
    setDialBusy(true);
    setDialMsg(null);
    const body: Record<string, unknown> = { destination };
    if (cidOverride && cidOverride.length > 0) body.cid = cidOverride;
    try {
      const res = await fetch('/api/agent/dial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        correlation_id?: string;
      };
      if (!res.ok || !j.ok) {
        setDialMsg(j.error ?? `dial failed (${res.status})`);
      } else {
        setDialMsg('dialing…');
        setBuffer('');
        // Iter 95 — remember the correlation_id so the BYE-miss
        // watchdog can poll its server-side hangup state.
        if (j.correlation_id) {
          setActiveCorrelationId(j.correlation_id);
        }
        // Iter 50 — push to local history. Dedup by destination+cid:
        // a redial of the same number bumps the existing entry rather
        // than creating a duplicate.
        const entry: HistoryEntry = {
          destination,
          cid: cidOverride && cidOverride.length > 0 ? cidOverride : null,
          ts: Date.now(),
        };
        setHistory((prev) => {
          const filtered = prev.filter(
            (h) =>
              !(h.destination === entry.destination && h.cid === entry.cid),
          );
          const next = [entry, ...filtered].slice(0, HISTORY_MAX);
          saveHistory(next);
          return next;
        });
      }
    } catch (e) {
      setDialMsg(e instanceof Error ? e.message : 'dial failed');
    } finally {
      setDialBusy(false);
    }
  }

  async function placeManualCall() {
    return placeCallTo(buffer, cid.trim() || null);
  }

  function pressDigit(d: string) {
    if (sp.inCall) {
      sp.sendDtmf(d);
      return;
    }
    // Iter 52 — buffer only fills while in the unlocked manual mode
    // (PAUSED + manual_dial cap). Pressing a digit on the keypad
    // while READY is a no-op so the agent can't accidentally
    // half-stage a number that the pacer might preempt.
    if (showingManual) {
      setDialMsg(null);
      setBuffer((b) => (b + d).slice(0, 24));
    }
  }

  // Iter 48 — global keyboard input. While the agent panel is mounted
  // any keypad-shaped key (digits / * / # / +) populates the dial
  // buffer or sends DTMF. Backspace deletes; Enter places the call.
  // Skipped when the user is typing into an input/textarea so the CID
  // field, wrap-up notes, etc don't double-route.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (
        t?.isContentEditable ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT'
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Digits + symbols
      if (/^[0-9*#]$/.test(e.key)) {
        e.preventDefault();
        pressDigit(e.key);
        return;
      }
      if (e.key === '+' && showingManual) {
        e.preventDefault();
        setDialMsg(null);
        setBuffer((b) => (b + '+').slice(0, 24));
        return;
      }
      if (e.key === 'Backspace' && showingManual) {
        e.preventDefault();
        setBuffer((b) => b.slice(0, -1));
        setDialMsg(null);
        return;
      }
      if (e.key === 'Enter' && showingManual && buffer.length > 0) {
        e.preventDefault();
        void placeManualCall();
        return;
      }
      if (e.key === 'Escape' && showingManual && buffer.length > 0) {
        e.preventDefault();
        setBuffer('');
        setDialMsg(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // pressDigit / placeManualCall close over current state, so re-bind
    // when those-relevant deps change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.inCall, manualDial, buffer, status]);

  function startTransfer() {
    if (!sp.inCall) return;
    const target = window.prompt(
      'Blind transfer to (extension or phone number):',
      '',
    );
    if (!target) return;
    void sp.transfer(target);
  }

  // Iter 52 — manual dial is gated on PAUSED. A READY agent is
  // reserved for the pacer's auto-bridge, so allowing them to dial
  // out manually races the pacer (it could bridge a call to them
  // mid-dial). ViciDial behavior: agent must dispose any pending
  // wrap-up, then pause, then dial. The keyboard / keypad / CID
  // input + CALL action are all gated on `showingManual`.
  const canManualDial = manualDial && status === 'PAUSED';
  const showingManual = canManualDial && !sp.inCall && !sp.error;
  const callerLine = sp.inCall
    ? sp.remoteIdentity ?? 'unknown'
    : sp.error
      ? 'OFFLINE'
      : showingManual && buffer.length > 0
        ? buffer
        : sp.registered
          ? showingManual
            ? 'DIAL'
            : status === 'PAUSED'
              ? 'PAUSED'
              : 'READY'
          : sp.ready
            ? 'REGISTERING'
            : 'CONNECTING';

  const statusLine = sp.error
    ? 'softphone error'
    : sp.inCall
      ? `Connected  ${formatElapsed(elapsed)}${sp.muted ? '  (muted)' : ''}${sp.onHold ? '  (held)' : ''}  RX:${sp.rxPackets} TX:${sp.txPackets} [${sp.iceState}]`
      : showingManual && buffer.length === 0
        ? 'Enter destination'
        : showingManual && buffer.length > 0
          ? dialMsg ?? 'Press CALL to dial'
          : status === 'PAUSED'
            ? 'Calls paused'
            : manualDial
              ? 'Pause to dial manually'
              : sp.registered
                ? 'Waiting for call'
                : ' ';

  return (
    <div
      className="w-full max-w-[340px] rounded-2xl shadow-2xl select-none"
      style={{
        background:
          'linear-gradient(160deg, #2a3140 0%, #1a1f2a 45%, #0e1218 100%)',
        boxShadow:
          '0 24px 48px -16px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      <div className="px-5 pt-4 pb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400 font-medium">
          DialerOS
        </span>
        <div className="flex items-center gap-2">
          <Led on={sp.registered} color="green" label="REG" />
          <Led on={sp.inCall} color="amber" label="LINE" />
          <Led on={status === 'PAUSED'} color="amber" label="PSE" />
        </div>
      </div>

      <div className="px-5 pt-2">
        <div
          className="rounded-md px-3 py-3 font-mono"
          style={{
            background:
              'linear-gradient(180deg, #0c2418 0%, #08170f 100%)',
            border: '1px solid rgba(120, 200, 140, 0.18)',
            boxShadow:
              'inset 0 1px 3px rgba(0,0,0,0.6), 0 0 12px rgba(120, 200, 140, 0.08)',
            color: '#9af2b5',
            textShadow: '0 0 6px rgba(154, 242, 181, 0.45)',
          }}
        >
          <div className="flex items-center justify-between text-[10px] opacity-80">
            <span>{sp.extension ? `EXT ${sp.extension}` : 'EXT —'}</span>
            <span>{now}</span>
          </div>
          <div className="text-base mt-1 leading-tight break-all min-h-[1.4em]">
            {callerLine}
            {showingManual && buffer.length > 0 && (
              <span className="opacity-70 animate-pulse">_</span>
            )}
          </div>
          <div className="text-[11px] opacity-80 mt-0.5 min-h-[1.2em]">
            {statusLine}
          </div>
        </div>

        {sp.inCall && (
          <div className="mt-2 space-y-1">
            <Vu label="MIC" level={sp.micLevel} />
            <Vu label="SPK" level={sp.spkLevel} />
          </div>
        )}
      </div>

      {showingManual && (
        <div className="px-5 pt-3">
          <label className="block">
            <div className="text-[9px] uppercase tracking-[0.18em] text-slate-500 mb-1">
              Caller ID (optional)
            </div>
            <input
              type="text"
              value={cid}
              onChange={(e) => setCid(e.target.value)}
              placeholder="e.g. +12025550100"
              className="w-full text-xs font-mono px-2 py-1.5 rounded bg-slate-900/60 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
              maxLength={40}
            />
          </label>
        </div>
      )}

      <div className="px-5 pt-3">
        <div className="grid grid-cols-3 gap-2">
          {KEYPAD.map((k) => (
            <KeyButton
              key={k.digit}
              digit={k.digit}
              letters={k.letters}
              disabled={!sp.inCall && !manualDial}
              onPress={() => pressDigit(k.digit)}
            />
          ))}
        </div>
      </div>

      <div className="px-5 pt-4">
        {sp.inCall ? (
          <div className="grid grid-cols-4 gap-1.5">
            <ActionKey
              tone={sp.muted ? 'amber' : 'neutral'}
              label={sp.muted ? 'Unmute' : 'Mute'}
              onPress={sp.toggleMute}
              compact
            />
            <ActionKey
              tone={sp.onHold ? 'amber' : 'neutral'}
              label={sp.onHold ? 'Resume' : 'Hold'}
              onPress={sp.toggleHold}
              compact
            />
            <ActionKey
              tone="neutral"
              label="Xfer"
              onPress={startTransfer}
              compact
            />
            <ActionKey
              tone="red"
              label="End"
              onPress={() => {
                void sp.hangup();
              }}
              compact
            />
          </div>
        ) : showingManual ? (
          <div className="grid grid-cols-3 gap-2">
            <ActionKey
              tone="neutral"
              label="Clear"
              disabled={buffer.length === 0}
              onPress={() => {
                setBuffer('');
                setDialMsg(null);
              }}
            />
            <ActionKey
              tone="green"
              label={dialBusy ? 'Dialing' : 'Call'}
              disabled={buffer.length === 0 || dialBusy}
              onPress={placeManualCall}
            />
            <ActionKey
              tone="neutral"
              label="⌫"
              disabled={buffer.length === 0}
              onPress={() => {
                setBuffer((b) => b.slice(0, -1));
                setDialMsg(null);
              }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <div />
            <ActionKey tone="neutral" label="Idle" disabled />
            <div />
          </div>
        )}
      </div>

      {showingManual && history.length > 0 && (
        <div className="px-5 pt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] uppercase tracking-[0.18em] text-slate-500">
              Recent
            </span>
            <button
              type="button"
              onClick={() => {
                setHistory([]);
                saveHistory([]);
              }}
              className="text-[9px] uppercase tracking-[0.15em] text-slate-600 hover:text-slate-400"
            >
              Clear
            </button>
          </div>
          <ul className="space-y-0.5">
            {history.slice(0, 5).map((h, i) => (
              <li
                key={`${h.destination}-${h.ts}-${i}`}
                onClick={() => {
                  setBuffer(h.destination);
                  setCid(h.cid ?? '');
                  setDialMsg(null);
                }}
                onDoubleClick={() => {
                  void placeCallTo(h.destination, h.cid);
                }}
                className="cursor-pointer text-[11px] font-mono text-slate-300 hover:bg-slate-800/60 hover:text-emerald-300 px-2 py-1 rounded flex items-center justify-between gap-2 select-none"
                title="Click to fill — double-click to redial"
              >
                <span className="truncate">{h.destination}</span>
                <span className="text-slate-600 text-[10px]">
                  {formatRelative(h.ts)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-5 pt-3">
        <button
          type="button"
          onClick={togglePause}
          disabled={statusBusy}
          className="w-full rounded-md py-2 text-xs font-medium uppercase tracking-wider transition-all active:translate-y-px disabled:opacity-40"
          style={{
            background:
              status === 'PAUSED'
                ? 'linear-gradient(180deg, #ca8a04 0%, #a16207 100%)'
                : 'linear-gradient(180deg, #475569 0%, #334155 50%, #1e293b 100%)',
            border:
              status === 'PAUSED'
                ? '1px solid rgba(253, 224, 71, 0.3)'
                : '1px solid rgba(255,255,255,0.08)',
            color: status === 'PAUSED' ? '#fef9c3' : '#e2e8f0',
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.08) inset, 0 2px 4px rgba(0,0,0,0.4)',
          }}
        >
          {status === 'PAUSED' ? 'Resume' : 'Pause'}
        </button>
      </div>

      <div className="px-5 pt-3 pb-5 mt-1">
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-[0.18em] text-slate-500">
            Vol
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sp.volume}
            onChange={(e) => sp.setVolume(parseFloat(e.target.value))}
            aria-label="Volume"
            className="flex-1 accent-emerald-400"
          />
          <span className="text-[10px] text-slate-400 font-mono tabular-nums w-7 text-right">
            {Math.round(sp.volume * 100)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Led({
  on,
  color,
  label,
}: {
  on: boolean;
  color: 'green' | 'amber';
  label: string;
}) {
  const onColor = color === 'green' ? '#34d399' : '#f59e0b';
  return (
    <span className="flex items-center gap-1">
      <span
        className="block h-1.5 w-1.5 rounded-full"
        style={{
          background: on ? onColor : '#1f2937',
          boxShadow: on ? `0 0 6px ${onColor}` : 'none',
        }}
      />
      <span className="text-[9px] uppercase tracking-[0.15em] text-slate-500">
        {label}
      </span>
    </span>
  );
}

function KeyButton({
  digit,
  letters,
  disabled,
  onPress,
}: {
  digit: string;
  letters?: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      className="rounded-md py-2 flex flex-col items-center justify-center transition-all active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background:
          'linear-gradient(180deg, #3b4555 0%, #232a37 50%, #161b24 100%)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow:
          '0 1px 0 rgba(255,255,255,0.04) inset, 0 2px 4px rgba(0,0,0,0.4)',
      }}
    >
      <span className="text-lg font-mono text-slate-100 leading-none">
        {digit}
      </span>
      <span className="text-[9px] tracking-[0.12em] text-slate-500 leading-none mt-1 h-[10px]">
        {letters ?? ' '}
      </span>
    </button>
  );
}

function ActionKey({
  tone,
  label,
  disabled,
  onPress,
  compact,
}: {
  tone: 'green' | 'red' | 'neutral' | 'amber';
  label: string;
  disabled?: boolean;
  onPress?: () => void;
  compact?: boolean;
}) {
  const palette = {
    green: {
      bg: 'linear-gradient(180deg, #16a34a 0%, #15803d 50%, #14532d 100%)',
      border: 'rgba(187, 247, 208, 0.25)',
      text: '#ecfdf5',
    },
    red: {
      bg: 'linear-gradient(180deg, #dc2626 0%, #b91c1c 50%, #7f1d1d 100%)',
      border: 'rgba(254, 202, 202, 0.25)',
      text: '#fef2f2',
    },
    amber: {
      bg: 'linear-gradient(180deg, #ca8a04 0%, #a16207 50%, #713f12 100%)',
      border: 'rgba(253, 224, 71, 0.3)',
      text: '#fef9c3',
    },
    neutral: {
      bg: 'linear-gradient(180deg, #475569 0%, #334155 50%, #1e293b 100%)',
      border: 'rgba(255,255,255,0.08)',
      text: '#e2e8f0',
    },
  }[tone];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPress}
      className={`rounded-md ${compact ? 'py-2 text-[11px]' : 'py-2.5 text-xs'} font-medium uppercase tracking-wider transition-all active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed`}
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.text,
        boxShadow:
          '0 1px 0 rgba(255,255,255,0.08) inset, 0 2px 4px rgba(0,0,0,0.4)',
      }}
    >
      {label}
    </button>
  );
}

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatClock(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatRelative(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function Vu({ label, level }: { label: string; level: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, level)) * 100);
  // Green / yellow / red bands match a typical hardware VU meter.
  const bg = pct > 80 ? '#ef4444' : pct > 50 ? '#fbbf24' : '#34d399';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] uppercase tracking-[0.18em] text-slate-500 w-8">
        {label}
      </span>
      <div className="relative flex-1 h-1.5 rounded overflow-hidden border border-slate-800/80 bg-slate-900/80">
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${pct}%`,
            background: bg,
            transition: 'width 60ms linear',
          }}
        />
      </div>
    </div>
  );
}
