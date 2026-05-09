'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

interface Item {
  id: string;
  name: string;
}

export function AttachmentsForm({
  userId,
  campaigns,
  inGroups,
  initialCampaignIds,
  initialInGroupIds,
}: {
  userId: string;
  campaigns: Item[];
  inGroups: Item[];
  initialCampaignIds: string[];
  initialInGroupIds: string[];
}) {
  const router = useRouter();
  const [campaignIds, setCampaignIds] = useState<Set<string>>(
    new Set(initialCampaignIds),
  );
  const [inGroupIds, setInGroupIds] = useState<Set<string>>(
    new Set(initialInGroupIds),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const campaignsDirty = useMemo(() => {
    const a = new Set(initialCampaignIds);
    if (a.size !== campaignIds.size) return true;
    for (const id of campaignIds) if (!a.has(id)) return true;
    return false;
  }, [initialCampaignIds, campaignIds]);

  const inGroupsDirty = useMemo(() => {
    const a = new Set(initialInGroupIds);
    if (a.size !== inGroupIds.size) return true;
    for (const id of inGroupIds) if (!a.has(id)) return true;
    return false;
  }, [initialInGroupIds, inGroupIds]);

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSuccess(null);

    if (campaignsDirty) {
      const res = await fetch(`/api/users/${userId}/campaigns`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_ids: [...campaignIds] }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setError(e.error ?? `Campaigns save failed (${res.status})`);
        setBusy(false);
        return;
      }
    }

    if (inGroupsDirty) {
      const res = await fetch(`/api/users/${userId}/in-groups`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ in_group_ids: [...inGroupIds] }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        setError(e.error ?? `In-groups save failed (${res.status})`);
        setBusy(false);
        return;
      }
    }

    setBusy(false);
    setSuccess('Saved.');
    router.refresh();
  }

  const dirty = campaignsDirty || inGroupsDirty;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-2">Allowed campaigns</h3>
        {campaigns.length === 0 ? (
          <p className="text-fg-subtle text-xs">No campaigns to attach.</p>
        ) : (
          <div className="space-y-1">
            {campaigns.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 px-3 py-2 border border-border rounded text-sm cursor-pointer hover:bg-card-hover"
              >
                <input
                  type="checkbox"
                  checked={campaignIds.has(c.id)}
                  onChange={() => toggle(campaignIds, setCampaignIds, c.id)}
                />
                <span>{c.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Allowed in-groups</h3>
        {inGroups.length === 0 ? (
          <p className="text-fg-subtle text-xs">No in-groups to attach.</p>
        ) : (
          <div className="space-y-1">
            {inGroups.map((g) => (
              <label
                key={g.id}
                className="flex items-center gap-2 px-3 py-2 border border-border rounded text-sm cursor-pointer hover:bg-card-hover"
              >
                <input
                  type="checkbox"
                  checked={inGroupIds.has(g.id)}
                  onChange={() => toggle(inGroupIds, setInGroupIds, g.id)}
                />
                <span>{g.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="border border-error/50 bg-error/10 text-error text-sm rounded p-2">
          {error}
        </div>
      )}
      {success && !error && (
        <div className="border border-success/50 bg-success/15 text-success text-sm rounded p-2">
          {success}
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={busy || !dirty}
        className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg px-4 py-2 rounded text-sm"
      >
        {busy ? 'Saving…' : dirty ? 'Save attachments' : 'No changes'}
      </button>
    </div>
  );
}
