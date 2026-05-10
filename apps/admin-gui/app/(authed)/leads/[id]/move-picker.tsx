'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface CampaignOpt {
  id: string;
  name: string;
  status: string;
}

const DETACH = '__detach__';

export function MoveListPicker({
  listId,
  currentCampaignId,
  campaigns,
}: {
  listId: string;
  currentCampaignId: string | null;
  campaigns: CampaignOpt[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState(currentCampaignId ?? DETACH);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{
    tone: 'ok' | 'err';
    text: string;
  } | null>(null);

  async function move() {
    const next = target === DETACH ? null : target;
    if (next === currentCampaignId) {
      setMsg({ tone: 'err', text: 'Pick a different campaign to move to.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/lead-lists/${listId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({
          tone: 'err',
          text: j.error ?? `move failed (${res.status})`,
        });
        return;
      }
      setMsg({
        tone: 'ok',
        text: next ? 'Moved.' : 'Detached. List is unattached.',
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-3 items-end">
      <label className="flex-1">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="input"
        >
          <option value={DETACH}>— detach (unattached) —</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.status})
              {c.id === currentCampaignId ? ' — current' : ''}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={move}
        disabled={busy}
        className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-50"
      >
        {busy ? 'Moving…' : 'Move'}
      </button>
      {msg && (
        <span
          className={`text-xs ${
            msg.tone === 'ok' ? 'text-success' : 'text-error'
          }`}
        >
          {msg.text}
        </span>
      )}
    </div>
  );
}
