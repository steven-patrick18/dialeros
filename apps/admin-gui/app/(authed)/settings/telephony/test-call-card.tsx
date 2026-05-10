'use client';

import { useState } from 'react';

interface CarrierOption {
  id: string;
  name: string;
  enabled: boolean;
}

type App = 'echo' | 'playback' | 'park';

const APP_HINT: Record<App, string> = {
  echo: 'After answer, FreeSWITCH echoes whatever the called party says back to them. Best for verifying 2-way audio.',
  playback:
    'After answer, FreeSWITCH plays a 2-second 440/480 Hz tone loop. Best when the called party can\'t speak back.',
  park: 'After answer, the call sits parked silent until hangup. Use for "did the carrier connect" tests where you don\'t need audio confirmation.',
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

  async function place() {
    if (!carrierId || !to.trim()) {
      setResult({ ok: false, error: 'Pick a carrier and enter a destination.' });
      return;
    }
    setBusy(true);
    setResult(null);
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded p-4">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
        Test call
      </h2>
      <p className="text-xs text-fg-subtle mb-3">
        Place a one-shot call through a carrier&apos;s pushed FreeSWITCH
        gateway. The carrier must be in REGED state on its detail page
        first &mdash; otherwise the originate fails before reaching the
        far end.
      </p>

      {carriers.length === 0 ? (
        <p className="text-fg-subtle text-sm">
          No carriers configured yet. Add one under Carriers &rarr; New.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <Field label="Carrier" hint="Which gateway to send the INVITE through. Disabled carriers are still selectable here so you can test before enabling.">
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
            hint="Destination number. Goes through the route plan's transforms only when called from a campaign — here it's dialed verbatim. Use full E.164 (+countrycode...) if your carrier requires it."
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
            label="CID (optional)"
            hint="Outbound caller-ID for this call. Empty = use whatever the carrier defaults to. Some carriers reject CIDs that aren't on their allow-list."
          >
            <input
              value={cid}
              onChange={(e) => setCid(e.target.value)}
              placeholder="default"
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
              <option value="echo">echo (test 2-way audio)</option>
              <option value="playback">playback (440/480 Hz tone)</option>
              <option value="park">park (silent until hangup)</option>
            </select>
          </Field>

          <Field
            label="Originate timeout"
            hint="How long FreeSWITCH waits for the far end to answer before giving up. Most carriers send progress within ~10s; bump to 60+ for international."
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
            disabled={busy}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-40"
          >
            {busy ? 'Placing call…' : 'Place test call'}
          </button>
          <span className="text-xs text-fg-subtle">
            Synchronous &mdash; the request blocks until the leg connects or fails.
          </span>
        </div>
      )}

      {result && (
        <div
          className={`mt-3 rounded border p-3 text-sm ${
            result.ok
              ? 'border-success/50 bg-success/10 text-success'
              : 'border-error/50 bg-error/10 text-error'
          }`}
        >
          {result.ok ? (
            <>
              <div>
                ✓ Call connected. Channel UUID:{' '}
                <span className="font-mono text-xs">{result.uuid}</span>
              </div>
              <div className="text-xs text-fg-subtle mt-1">
                Gateway: <span className="font-mono">{result.gateway}</span>
                {result.cid && (
                  <>
                    {' '}· CID: <span className="font-mono">{result.cid}</span>
                  </>
                )}
              </div>
              <div className="text-xs text-fg-subtle mt-1">
                Hang up the called party to end. Or:{' '}
                <span className="font-mono">
                  fs_cli -x &quot;uuid_kill {result.uuid}&quot;
                </span>
              </div>
            </>
          ) : (
            <>
              <div>✗ {result.error}</div>
              {result.code && (
                <div className="text-xs text-fg-subtle mt-1">
                  Code: <span className="font-mono">{result.code}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
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
