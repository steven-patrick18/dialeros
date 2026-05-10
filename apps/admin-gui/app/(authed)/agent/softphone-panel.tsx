'use client';

import { useEffect, useRef, useState } from 'react';
import { useSoftphone } from '@/components/softphone';

// Iter 39 — eyeBeam-style softphone for the agent console.
// Iter 40 — added: pause/resume presence, manual-dial buffer for
// expert users (gated on manual_dial returned by /softphone-config).

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

export function AgentSoftphonePanel() {
  const sp = useSoftphone();
  const [elapsed, setElapsed] = useState(0);
  const [now, setNow] = useState<string>(formatClock(new Date()));
  const startedAt = useRef<number | null>(null);

  const [status, setStatus] = useState<AgentStatus>('AVAILABLE');
  const [statusBusy, setStatusBusy] = useState(false);

  const [manualDial, setManualDial] = useState(false);
  const [buffer, setBuffer] = useState('');
  const [dialBusy, setDialBusy] = useState(false);
  const [dialMsg, setDialMsg] = useState<string | null>(null);

  // Read manual_dial flag from softphone-config (same endpoint the
  // SIP UA uses) so the panel knows whether to expose the dial input.
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

  // Pull current presence on mount.
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

  async function placeManualCall() {
    if (!buffer || sp.inCall || dialBusy) return;
    setDialBusy(true);
    setDialMsg(null);
    try {
      const res = await fetch('/api/agent/dial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: buffer }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setDialMsg(j.error ?? `dial failed (${res.status})`);
      } else {
        setDialMsg('dialing…');
        setBuffer('');
      }
    } catch (e) {
      setDialMsg(e instanceof Error ? e.message : 'dial failed');
    } finally {
      setDialBusy(false);
    }
  }

  function pressDigit(d: string) {
    if (sp.inCall) {
      sp.sendDtmf(d);
      return;
    }
    if (manualDial) {
      setDialMsg(null);
      setBuffer((b) => (b + d).slice(0, 24));
    }
  }

  // Compose the LCD text.
  const showingManual = manualDial && !sp.inCall && !sp.error;
  const callerLine = sp.inCall
    ? sp.remoteIdentity ?? 'unknown'
    : sp.error
      ? 'OFFLINE'
      : showingManual && buffer.length > 0
        ? buffer
        : status === 'PAUSED'
          ? 'PAUSED'
          : sp.registered
            ? 'READY'
            : sp.ready
              ? 'REGISTERING'
              : 'CONNECTING';

  const statusLine = sp.error
    ? 'softphone error'
    : sp.inCall
      ? `Connected  ${formatElapsed(elapsed)}${sp.muted ? '  (muted)' : ''}`
      : showingManual && buffer.length === 0
        ? 'Enter destination'
        : showingManual && buffer.length > 0
          ? dialMsg ?? 'Press CALL to dial'
          : status === 'PAUSED'
            ? 'Calls paused'
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
      </div>

      <div className="px-5 pt-4">
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
        <div className="grid grid-cols-3 gap-2">
          {sp.inCall ? (
            <>
              <ActionKey
                tone="neutral"
                label={sp.muted ? 'Unmute' : 'Mute'}
                onPress={sp.toggleMute}
              />
              <ActionKey tone="green" label="On call" disabled />
              <ActionKey
                tone="red"
                label="End"
                onPress={() => {
                  void sp.hangup();
                }}
              />
            </>
          ) : showingManual ? (
            <>
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
                disabled={
                  buffer.length === 0 || dialBusy || status === 'PAUSED'
                }
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
            </>
          ) : (
            <>
              <div />
              <ActionKey tone="neutral" label="Idle" disabled />
              <div />
            </>
          )}
        </div>
      </div>

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
}: {
  tone: 'green' | 'red' | 'neutral';
  label: string;
  disabled?: boolean;
  onPress?: () => void;
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
      className="rounded-md py-2.5 text-xs font-medium uppercase tracking-wider transition-all active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed"
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
