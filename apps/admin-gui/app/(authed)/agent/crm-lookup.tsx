'use client';

import { useState } from 'react';

interface Result {
  found: boolean;
  external_id?: string;
  display_name?: string;
  email?: string;
  company?: string;
  attributes?: Record<string, string>;
  provider_error?: string;
}

// Iter 185 — Agent-side CRM lookup popover. Compact button that
// expands to show the lookup result inline. Re-clicks re-fetch
// (useful if the agent updated the contact in the CRM tab and
// wants to see the change).

export function CrmLookupButton({ phone }: { phone: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function lookup() {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/crm-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ phone }),
      });
      if (res.status === 404) {
        // No provider enabled — hide silently next time.
        setResult({ found: false, provider_error: 'no_enabled_provider' });
        return;
      }
      if (!res.ok) {
        setResult({ found: false, provider_error: `http_${res.status}` });
        return;
      }
      const data = (await res.json()) as Result;
      setResult(data);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    if (!open) {
      setOpen(true);
      if (result === null) void lookup();
    } else {
      setOpen(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        onClick={toggle}
        className="text-link hover:text-accent-hover text-[11px] uppercase tracking-wide"
        title="Look up in CRM"
      >
        {open ? '▾' : '▸'} crm
      </button>
      {open && (
        <span className="ml-2 inline-block text-[11px]">
          {loading ? (
            <span className="text-fg-subtle">looking up…</span>
          ) : result === null ? null : !result.found ? (
            <span className="text-fg-muted">
              no match
              {result.provider_error
                ? ` (${result.provider_error})`
                : ''}
            </span>
          ) : (
            <span className="font-normal">
              {result.display_name && (
                <span className="text-fg mr-2">
                  {result.display_name}
                </span>
              )}
              {result.email && (
                <span className="text-fg-subtle mr-2">
                  {result.email}
                </span>
              )}
              {result.company && (
                <span className="text-fg-subtle">{result.company}</span>
              )}
            </span>
          )}
          <button
            type="button"
            onClick={() => void lookup()}
            disabled={loading}
            className="ml-2 text-fg-subtle hover:text-fg text-[10px]"
            title="Refresh"
          >
            ↻
          </button>
        </span>
      )}
    </span>
  );
}
