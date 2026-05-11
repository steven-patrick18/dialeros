'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function VoicemailPanel({
  campaignId,
  amdAction,
  voicemailPath,
}: {
  campaignId: string;
  amdAction: string;
  voicemailPath: string | null;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = fileInput.current?.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/campaigns/${campaignId}/voicemail`, {
      method: 'POST',
      body: fd,
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({ tone: 'err', text: j.error ?? `upload failed (${res.status})` });
      return;
    }
    setMsg({ tone: 'ok', text: 'Voicemail uploaded.' });
    if (fileInput.current) fileInput.current.value = '';
    router.refresh();
  }

  async function remove() {
    if (!confirm('Remove the voicemail file from this campaign?')) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/campaigns/${campaignId}/voicemail`, {
      method: 'DELETE',
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({ tone: 'err', text: j.error ?? `remove failed (${res.status})` });
      return;
    }
    setMsg({ tone: 'ok', text: 'Voicemail cleared.' });
    router.refresh();
  }

  return (
    <div className="border border-border rounded p-4">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
        Voicemail file
      </h2>
      <p className="text-xs text-fg-subtle mb-3">
        Used when <span className="font-mono">on answer = voicemail</span>{' '}
        above. The pacer originates as normal but, at answer, FreeSWITCH
        plays this <span className="font-mono">.wav</span> and hangs up
        — no agent is involved. Useful for compliance notifications and
        opt-out broadcasts.
      </p>

      <div className="text-xs mb-3">
        Current:{' '}
        {voicemailPath ? (
          <span className="font-mono text-fg break-all">{voicemailPath}</span>
        ) : (
          <span className="text-fg-subtle">(none uploaded)</span>
        )}
      </div>

      {amdAction === 'voicemail' && !voicemailPath && (
        <div className="border border-warn/40 bg-warn/5 text-warn text-xs rounded p-2 mb-3">
          Voicemail mode is active but no file is uploaded. Pacer will
          fall back to the bridge target until a file is provided.
        </div>
      )}

      <form onSubmit={upload} className="flex items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept=".wav,audio/wav"
          required
          className="text-xs"
        />
        <button
          type="submit"
          disabled={busy}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-xs disabled:opacity-50"
        >
          {busy ? 'Uploading…' : 'Upload .wav'}
        </button>
        {voicemailPath && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-error/40 text-error hover:bg-error/10"
          >
            Remove
          </button>
        )}
        {msg && (
          <span
            className={`text-xs ${
              msg.tone === 'ok' ? 'text-success' : 'text-error'
            }`}
          >
            {msg.text}
          </span>
        )}
      </form>
    </div>
  );
}
