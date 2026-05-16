'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AudioPicker } from '@/components/audio-picker';

// Iter 154 — On Answer Behaviour card. Replaces the simple
// InlineCardForm dropdown with a stateful form that reveals the
// right sub-fields per selected amd_action.
//
// Top-level amd_action options:
//   bridge      — connect to agent (no sub-fields)
//   detect      — AMD with HUMAN / MACHINE sub-actions
//   voicemail   — play uploaded .wav (voicemail_path managed separately)
//   audio_drop  — play any sound-board file then hangup (ViciDial 8373)
//   call_menu   — drop to a Call Menu (ViciDial 8366)
//   drop        — hangup at answer
//
// HUMAN sub-actions (when amd_action='detect'):
//   bridge | call_menu | drop
//
// MACHINE sub-actions (when amd_action='detect'):
//   voicemail | audio_drop | call_menu | drop

interface CallMenuOpt {
  id: string;
  name: string;
}

interface Props {
  campaignId: string;
  initial: {
    amd_action: string;
    on_answer_call_menu_id: string | null;
    audio_drop_path: string | null;
    amd_human_action: string | null;
    amd_human_call_menu_id: string | null;
    amd_machine_action: string | null;
    amd_machine_call_menu_id: string | null;
    amd_machine_audio_path: string | null;
    no_agent_call_menu_id: string | null;
    recording_notice_audio_path: string | null;
  };
}

export function OnAnswerCard({ campaignId, initial }: Props) {
  const router = useRouter();
  const [amdAction, setAmdAction] = useState(initial.amd_action || 'bridge');
  const [onAnswerCallMenuId, setOnAnswerCallMenuId] = useState(
    initial.on_answer_call_menu_id ?? '',
  );
  const [audioDropPath, setAudioDropPath] = useState(
    initial.audio_drop_path ?? '',
  );
  const [humanAction, setHumanAction] = useState(
    initial.amd_human_action || 'bridge',
  );
  const [humanCallMenuId, setHumanCallMenuId] = useState(
    initial.amd_human_call_menu_id ?? '',
  );
  const [machineAction, setMachineAction] = useState(
    initial.amd_machine_action || 'voicemail',
  );
  const [machineCallMenuId, setMachineCallMenuId] = useState(
    initial.amd_machine_call_menu_id ?? '',
  );
  const [machineAudioPath, setMachineAudioPath] = useState(
    initial.amd_machine_audio_path ?? '',
  );
  // Iter 156 — separate from detect/HUMAN-MACHINE; fires when no
  // local agent is available at originate time.
  const [noAgentCallMenuId, setNoAgentCallMenuId] = useState(
    initial.no_agent_call_menu_id ?? '',
  );
  // Iter 167 — Recording notice audio (compliance).
  const [recordingNoticePath, setRecordingNoticePath] = useState(
    initial.recording_notice_audio_path ?? '',
  );
  const [menus, setMenus] = useState<CallMenuOpt[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch('/api/call-menus', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((data: { menus: CallMenuOpt[] }) => setMenus(data.menus))
      .catch(() => setMenus([]));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          amd_action: amdAction,
          on_answer_call_menu_id:
            amdAction === 'call_menu' ? onAnswerCallMenuId || null : null,
          audio_drop_path:
            amdAction === 'audio_drop' ? audioDropPath || null : null,
          amd_human_action: amdAction === 'detect' ? humanAction : null,
          amd_human_call_menu_id:
            amdAction === 'detect' && humanAction === 'call_menu'
              ? humanCallMenuId || null
              : null,
          amd_machine_action: amdAction === 'detect' ? machineAction : null,
          amd_machine_call_menu_id:
            amdAction === 'detect' && machineAction === 'call_menu'
              ? machineCallMenuId || null
              : null,
          amd_machine_audio_path:
            amdAction === 'detect' && machineAction === 'audio_drop'
              ? machineAudioPath || null
              : null,
          no_agent_call_menu_id: noAgentCallMenuId || null,
          recording_notice_audio_path: recordingNoticePath || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function MenuPicker({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (v: string) => void;
    label: string;
  }) {
    return (
      <label className="text-sm flex flex-col gap-1">
        <span className="text-fg-subtle">{label}</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input"
        >
          <option value="">— pick a call menu —</option>
          {menus.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {menus.length === 0 ? (
          <span className="text-xs text-fg-subtle">
            No call menus defined.{' '}
            <a href="/call-menus/add" className="text-link hover:underline">
              Create one
            </a>
            .
          </span>
        ) : null}
      </label>
    );
  }

  return (
    <div className="border border-border rounded p-4 bg-card space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">On answer behaviour</h2>
        <span className="text-xs text-fg-subtle">ViciDial parity</span>
      </div>

      <label className="text-sm flex flex-col gap-1">
        <span className="text-fg-subtle">When the lead answers</span>
        <select
          value={amdAction}
          onChange={(e) => setAmdAction(e.target.value)}
          className="input"
        >
          <option value="bridge">
            bridge — connect the lead to an agent (default)
          </option>
          <option value="detect">
            detect — AMD: route HUMAN and MACHINE to different sub-actions
          </option>
          <option value="voicemail">
            voicemail — play the uploaded .wav and hang up (voice-blast)
          </option>
          <option value="audio_drop">
            audio_drop — play a Sound Board file then hang up (ext 8373)
          </option>
          <option value="call_menu">
            call_menu — drop the caller into an IVR menu (ext 8366)
          </option>
          <option value="drop">
            drop — hang up at answer (connectivity probing only)
          </option>
        </select>
      </label>

      {amdAction === 'call_menu' ? (
        <MenuPicker
          value={onAnswerCallMenuId}
          onChange={setOnAnswerCallMenuId}
          label="Call menu to drop into"
        />
      ) : null}

      {amdAction === 'audio_drop' ? (
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Audio file to play</span>
          <AudioPicker
            value={audioDropPath}
            onChange={setAudioDropPath}
            category="disclaimer"
          />
        </label>
      ) : null}

      {amdAction === 'detect' ? (
        <div className="space-y-4 pt-2 border-t border-border">
          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-fg-subtle">
              If HUMAN (amd_v2 + NOTSURE/UNKNOWN fallbacks)
            </h3>
            <label className="text-sm flex flex-col gap-1">
              <span className="text-fg-subtle">Sub-action</span>
              <select
                value={humanAction}
                onChange={(e) => setHumanAction(e.target.value)}
                className="input"
              >
                <option value="bridge">bridge to an agent (default)</option>
                <option value="call_menu">
                  drop into a call menu (e.g. press 1 to talk to sales)
                </option>
                <option value="drop">hang up</option>
              </select>
            </label>
            {humanAction === 'call_menu' ? (
              <MenuPicker
                value={humanCallMenuId}
                onChange={setHumanCallMenuId}
                label="HUMAN → call menu"
              />
            ) : null}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-fg-subtle">
              If MACHINE
            </h3>
            <label className="text-sm flex flex-col gap-1">
              <span className="text-fg-subtle">Sub-action</span>
              <select
                value={machineAction}
                onChange={(e) => setMachineAction(e.target.value)}
                className="input"
              >
                <option value="voicemail">
                  drop voicemail (wait for beep, play uploaded .wav)
                </option>
                <option value="audio_drop">
                  audio drop (Sound Board file, no beep wait)
                </option>
                <option value="call_menu">
                  drop into a call menu (rare — leave a menu on a machine)
                </option>
                <option value="drop">hang up</option>
              </select>
            </label>
            {machineAction === 'call_menu' ? (
              <MenuPicker
                value={machineCallMenuId}
                onChange={setMachineCallMenuId}
                label="MACHINE → call menu"
              />
            ) : null}
            {machineAction === 'audio_drop' ? (
              <label className="text-sm flex flex-col gap-1">
                <span className="text-fg-subtle">MACHINE → audio file</span>
                <AudioPicker
                  value={machineAudioPath}
                  onChange={setMachineAudioPath}
                  category="voicemail"
                />
              </label>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="pt-3 border-t border-border">
        <h3 className="text-xs uppercase tracking-wide text-fg-subtle mb-2">
          Recording notice (iter 167 — two-party-consent compliance)
        </h3>
        <p className="text-xs text-fg-subtle mb-2">
          When set, this audio plays to the caller before record_session
          starts on the agent bridge. Notice file is NOT included in
          the saved recording (compliance: notice = consent ask;
          recording = consented audio).
        </p>
        <AudioPicker
          value={recordingNoticePath}
          onChange={setRecordingNoticePath}
          category="disclaimer"
        />
      </div>

      <div className="pt-3 border-t border-border">
        <h3 className="text-xs uppercase tracking-wide text-fg-subtle mb-2">
          No-agent drop (independent of amd_action)
        </h3>
        <p className="text-xs text-fg-subtle mb-2">
          If the pacer originates an outbound but every local agent
          is taken at the moment of answer, this call menu plays
          instead of an &amp;hangup abandon. Reduces iter-146 &lsquo;A&rsquo;
          dispositions when an operator-built &ldquo;press 1 to leave a
          message&rdquo; menu is available.
        </p>
        <MenuPicker
          value={noAgentCallMenuId}
          onChange={setNoAgentCallMenuId}
          label="Menu to drop into when no agent available"
        />
      </div>

      {error ? <div className="text-error text-sm">{error}</div> : null}
      {success ? (
        <div className="text-success text-sm">Saved.</div>
      ) : null}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
