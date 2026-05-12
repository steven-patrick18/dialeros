'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Iter 140 — per-campaign voicemail-drop tuning. Surfaces the 5
// dialplan wait-for-beep knobs as numeric inputs. Saves to the
// campaign as JSON in voicemail_config; clearing reverts to the
// dialplan defaults (256 / 25 / 4 / 30000 / 750).

interface VoicemailConfig {
  silence_thresh: number;
  silence_hits: number;
  listen_hits: number;
  silence_timeout_ms: number;
  beep_grace_ms: number;
}

interface Props {
  campaignId: string;
  amdAction: string;
  initialConfig: VoicemailConfig;
  usingDefaults: boolean;
}

const DEFAULTS: VoicemailConfig = {
  silence_thresh: 256,
  silence_hits: 25,
  listen_hits: 4,
  silence_timeout_ms: 30_000,
  beep_grace_ms: 750,
};

export function VoicemailTuningCard({
  campaignId,
  amdAction,
  initialConfig,
  usingDefaults,
}: Props) {
  const router = useRouter();
  const [cfg, setCfg] = useState<VoicemailConfig>(() => ({ ...initialConfig }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  // Card only matters when the campaign actually routes through
  // the iter-139 dialplan path.
  const relevant = amdAction === 'voicemail' || amdAction === 'detect';

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voicemail_config: JSON.stringify(cfg) }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || (j.ok !== undefined && !j.ok)) {
        setMsg({ tone: 'err', text: j.error ?? `save failed (${res.status})` });
        return;
      }
      setMsg({
        tone: 'ok',
        text: 'Saved — applies to the next answered call routed through AMD.',
      });
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
    if (
      !confirm('Revert to dialplan defaults? Custom values will be discarded.')
    ) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voicemail_config: null }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || (j.ok !== undefined && !j.ok)) {
        setMsg({ tone: 'err', text: j.error ?? `reset failed (${res.status})` });
        return;
      }
      setCfg({ ...DEFAULTS });
      setMsg({ tone: 'ok', text: 'Reverted to dialplan defaults.' });
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
    <div className="border border-border rounded p-4 mb-4 max-w-3xl">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-sm font-medium">Voicemail-drop tuning</h2>
        {usingDefaults ? (
          <span className="text-fg-subtle text-[10px] uppercase tracking-wide">
            using defaults
          </span>
        ) : (
          <span className="text-info text-[10px] uppercase tracking-wide">
            custom curve
          </span>
        )}
      </div>
      <p className="text-fg-subtle text-xs mb-3 max-w-prose">
        Iter 139 added &ldquo;wait for the answering-machine greeting
        to end + a grace window for the beep&rdquo; before dropping the
        voicemail. These knobs let you tune that for carriers whose
        machines have unusual cadence. Only takes effect when{' '}
        <span className="font-mono">amd_action</span> is{' '}
        <span className="font-mono">voicemail</span> or{' '}
        <span className="font-mono">detect</span>.
        {!relevant && (
          <span className="block mt-1 text-warn">
            This campaign uses{' '}
            <span className="font-mono">{amdAction}</span> — settings
            below are saved but won&apos;t fire until you switch the
            on-answer behaviour above.
          </span>
        )}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <Field
          label="Silence threshold"
          hint="Energy level below which a frame counts as silence (50–10000). Lower = more sensitive; raise if the machine's greeting is detected as 'still going' too long."
          value={cfg.silence_thresh}
          min={50}
          max={10_000}
          onChange={(v) =>
            setCfg((c) => ({ ...c, silence_thresh: v }))
          }
        />
        <Field
          label="Silence hits"
          hint="Consecutive silent frames (×20ms) before the greeting is declared over. 25 ≈ 500ms — works for most VMs."
          value={cfg.silence_hits}
          min={5}
          max={500}
          onChange={(v) =>
            setCfg((c) => ({ ...c, silence_hits: v }))
          }
        />
        <Field
          label="Listen hits"
          hint="Voice frames required before we'll honour a silence. Higher = skips longer pauses inside the greeting (some carriers narrate slowly)."
          value={cfg.listen_hits}
          min={1}
          max={50}
          onChange={(v) =>
            setCfg((c) => ({ ...c, listen_hits: v }))
          }
        />
        <Field
          label="Silence timeout (ms)"
          hint="Hard ceiling. Most greetings finish under 20s; the timeout catches pathological cases (broken machines, manual mid-flow pickup)."
          value={cfg.silence_timeout_ms}
          min={2_000}
          max={120_000}
          step={500}
          onChange={(v) =>
            setCfg((c) => ({ ...c, silence_timeout_ms: v }))
          }
        />
        <Field
          label="Beep grace (ms)"
          hint="Pause AFTER silence is detected, BEFORE playback starts — lets the actual beep tone finish so the drop doesn't overlap with it."
          value={cfg.beep_grace_ms}
          min={0}
          max={5_000}
          step={50}
          onChange={(v) =>
            setCfg((c) => ({ ...c, beep_grace_ms: v }))
          }
        />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save tuning'}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={busy || usingDefaults}
          className="text-xs px-3 py-1.5 rounded border border-warn/50 text-warn hover:bg-warn/10 disabled:opacity-40"
        >
          Revert to defaults
        </button>
      </div>
      {msg && (
        <p
          className={`text-xs ${msg.tone === 'ok' ? 'text-success' : 'text-error'}`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">
        {label}
      </div>
      <input
        type="number"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="input w-32"
      />
      <p className="text-[10px] text-fg-subtle mt-1">{hint}</p>
    </label>
  );
}
