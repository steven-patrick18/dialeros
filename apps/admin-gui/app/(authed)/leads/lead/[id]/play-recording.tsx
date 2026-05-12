'use client';

import { useState } from 'react';

// Iter 97 — compact recording playback for the per-lead call
// history table. Mirrors the agent feed's toggle pattern so an
// operator can scan a 50-row table without 50 audio elements
// loading metadata up front. preload="metadata" only fires after
// the operator opts in by clicking ▶.
export function PlayRecording({
  intentId,
  available,
}: {
  intentId: number;
  available: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!available) {
    return <span className="text-fg-subtle">—</span>;
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-accent hover:text-accent-hover text-[11px] uppercase tracking-wide"
        title={open ? 'Hide player' : 'Play recording'}
      >
        {open ? '▣ close' : '▶ play'}
      </button>
      {open && (
        <audio
          src={`/api/recordings/${intentId}`}
          controls
          preload="metadata"
          autoPlay
          className="mt-1 h-7 w-56"
        />
      )}
    </div>
  );
}
