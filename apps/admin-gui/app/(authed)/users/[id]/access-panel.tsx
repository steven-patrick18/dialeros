'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

// Iter 43 — ViciDial-style ACL matrix. Renders a checkbox grid grouped
// by resource (Users, Telephony, Campaigns, ...) with the user's
// current effective permissions checked. Save sends the explicit array
// to PATCH /api/users/[id]; "Reset to role default" sends null which
// clears the override. Admins pass through this view but the
// checkboxes stay disabled — admins implicitly have everything.

interface CatalogEntry {
  slug: string;
  label: string;
  group: string;
}

export function AccessPanel({
  userId,
  role,
  catalog,
  initialGranted,
  initialOverridden,
  isAdmin,
}: {
  userId: string;
  role: string;
  catalog: CatalogEntry[];
  initialGranted: string[];
  initialOverridden: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [granted, setGranted] = useState<Set<string>>(
    () => new Set(initialGranted),
  );
  const [overridden, setOverridden] = useState(initialOverridden);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  const groups = useMemo(() => {
    const out = new Map<string, CatalogEntry[]>();
    for (const p of catalog) {
      const arr = out.get(p.group) ?? [];
      arr.push(p);
      out.set(p.group, arr);
    }
    return Array.from(out.entries());
  }, [catalog]);

  const dirty = useMemo(() => {
    if (granted.size !== initialGranted.length) return true;
    for (const s of granted) if (!initialGranted.includes(s)) return true;
    return false;
  }, [granted, initialGranted]);

  function toggle(slug: string) {
    setMsg(null);
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: Array.from(granted) }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({ tone: 'err', text: j.error ?? `save failed (${res.status})` });
      return;
    }
    setOverridden(true);
    setMsg({ tone: 'ok', text: 'Saved.' });
    router.refresh();
  }

  async function resetToRoleDefault() {
    if (
      !confirm(
        `Clear the ACL override and fall back to the ${role} role's default permissions?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: null }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({ tone: 'err', text: j.error ?? `reset failed (${res.status})` });
      return;
    }
    setMsg({ tone: 'ok', text: 'Reset to role defaults — refreshing.' });
    router.refresh();
  }

  return (
    <div>
      {isAdmin && (
        <div className="mb-3 text-xs text-fg-subtle">
          Admins implicitly have every permission. The matrix below is
          read-only for admin accounts.
        </div>
      )}
      {!isAdmin && (
        <div className="mb-3 text-xs text-fg-subtle">
          {overridden ? (
            <>
              This user has an explicit ACL override.{' '}
              <button
                type="button"
                onClick={resetToRoleDefault}
                disabled={busy}
                className="underline text-fg-muted hover:text-fg disabled:opacity-50"
              >
                Reset to {role} defaults
              </button>
            </>
          ) : (
            <>Showing the default permissions for the {role} role.</>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        {groups.map(([group, entries]) => (
          <div key={group}>
            <h3 className="text-[11px] uppercase tracking-wide text-fg-muted mb-1.5">
              {group}
            </h3>
            <ul className="space-y-1">
              {entries.map((p) => {
                const checked = isAdmin || granted.has(p.slug);
                return (
                  <li key={p.slug}>
                    <label className="inline-flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isAdmin || busy}
                        onChange={() => toggle(p.slug)}
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        <span className="text-fg">{p.label}</span>
                        <span className="block text-[11px] text-fg-subtle font-mono">
                          {p.slug}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {!isAdmin && (
        <div className="flex items-center gap-3 mt-5">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || busy}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save permissions'}
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
      )}
    </div>
  );
}
