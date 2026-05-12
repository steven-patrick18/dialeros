'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Iter 128 — clone-campaign control on the basic tab. Opens a
// modal for the new name + the "carry lead lists" opt-in; on
// success the operator gets redirected straight to the new
// campaign's detail page.

export function CloneCampaignButton({
  campaignId,
  defaultName,
}: {
  campaignId: string;
  defaultName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${defaultName} (copy)`);
  const [includeLists, setIncludeLists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName(`${defaultName} (copy)`);
    setIncludeLists(false);
    setError(null);
    setBusy(false);
  }

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          include_lead_lists: includeLists,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        error?: string;
      };
      if (!res.ok || !j.ok || !j.id) {
        setError(j.error ?? `clone failed (${res.status})`);
        setBusy(false);
        return;
      }
      // Redirect to the new campaign's basic tab.
      router.push(`/campaigns/${j.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'clone failed');
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="text-xs px-3 py-1 rounded border border-border text-fg-muted hover:text-fg hover:bg-card-hover/40"
        title="Duplicate this campaign with all settings carried over"
      >
        Clone
      </button>
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md p-5 mx-4">
            <h2 className="text-lg font-semibold mb-1">Clone campaign</h2>
            <p className="text-fg-subtle text-xs mb-4">
              Copies route plan, pacing, AMD, list order, dialable
              statuses, and in-group attachments. New campaign starts
              paused.
            </p>
            <label className="block mb-3">
              <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">
                New name
              </div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                className="input"
                autoFocus
              />
            </label>
            <label className="flex items-start gap-2 mb-4 text-xs">
              <input
                type="checkbox"
                checked={includeLists}
                onChange={(e) => setIncludeLists(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-fg-muted">
                Also attach the same lead lists.
                {includeLists && (
                  <span className="text-warn block mt-0.5">
                    Both campaigns will pace against the same leads —
                    only enable if you want a second pass with
                    different routing.
                  </span>
                )}
              </span>
            </label>
            {error && (
              <p className="text-error text-xs mb-3">{error}</p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded border border-border text-fg-muted hover:text-fg disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!name.trim() || busy}
                className="text-xs px-3 py-1.5 rounded bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50"
              >
                {busy ? 'Cloning…' : 'Clone campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
