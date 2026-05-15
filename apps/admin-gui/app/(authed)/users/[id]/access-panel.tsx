'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

// Iter 43 — ViciDial-style ACL matrix.
// Iter 192 — adds the numeric user_level (1-9) selector + the
// level gate: a ticked permission whose minLevel exceeds the
// selected level renders inert (greyed, "needs L<n>") because
// effectivePermissions() will not honour it server-side either.
// Admins pass through read-only (implicit everything).

interface CatalogEntry {
  slug: string;
  label: string;
  group: string;
  minLevel: number;
}
interface LevelDef {
  level: number;
  label: string;
}

export function AccessPanel({
  userId,
  role,
  catalog,
  initialGranted,
  initialOverridden,
  initialLevel,
  userLevels,
  isAdmin,
  canEdit,
}: {
  userId: string;
  role: string;
  catalog: CatalogEntry[];
  initialGranted: string[];
  initialOverridden: boolean;
  initialLevel: number;
  userLevels: LevelDef[];
  isAdmin: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [granted, setGranted] = useState<Set<string>>(
    () => new Set(initialGranted),
  );
  const [level, setLevel] = useState<number>(initialLevel);
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
    if (level !== initialLevel) return true;
    if (granted.size !== initialGranted.length) return true;
    for (const s of granted) if (!initialGranted.includes(s)) return true;
    return false;
  }, [granted, initialGranted, level, initialLevel]);

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
      body: JSON.stringify({
        permissions: Array.from(granted),
        user_level: level,
      }),
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
        `Clear the ACL override and fall back to the ${role} role's default permissions? (user level is left unchanged)`,
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

  const editable = canEdit && !isAdmin;

  return (
    <div>
      {/* User level */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm text-fg-subtle w-28">User level</label>
        <select
          value={level}
          disabled={!canEdit || isAdmin || busy}
          onChange={(e) => {
            setMsg(null);
            setLevel(Number(e.target.value));
          }}
          className="border border-border rounded bg-bg px-2 py-1 text-sm"
        >
          {userLevels.map((l) => (
            <option key={l.level} value={l.level}>
              {l.label}
            </option>
          ))}
        </select>
        {isAdmin && (
          <span className="text-xs text-fg-subtle">
            admin = implicit level 9
          </span>
        )}
      </div>

      {isAdmin && (
        <div className="mb-3 text-xs text-fg-subtle">
          Admins implicitly have every permission at level 9. The
          matrix below is read-only for admin accounts.
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
                disabled={!editable || busy}
                className="underline text-fg-muted hover:text-fg disabled:opacity-50"
              >
                Reset to {role} defaults
              </button>
            </>
          ) : (
            <>Showing the default permissions for the {role} role.</>
          )}
          <span className="block mt-1">
            A ticked permission is <strong>inert</strong> until the
            user level meets its minimum (ViciDial pairing).
          </span>
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
                const ticked = isAdmin || granted.has(p.slug);
                const levelOk = isAdmin || level >= p.minLevel;
                const inert = ticked && !levelOk;
                return (
                  <li key={p.slug}>
                    <label
                      className={`inline-flex items-start gap-2 text-sm ${
                        inert ? 'opacity-50' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={ticked}
                        disabled={!editable || busy}
                        onChange={() => toggle(p.slug)}
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        <span className="text-fg">
                          {p.label}
                          {inert && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide px-1 py-0.5 rounded border border-warn/40 text-warn">
                              needs L{p.minLevel}
                            </span>
                          )}
                          {!ticked && !isAdmin && (
                            <span className="ml-2 text-[10px] text-fg-muted">
                              L{p.minLevel}+
                            </span>
                          )}
                        </span>
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
            disabled={!editable || !dirty || busy}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save access'}
          </button>
          {!canEdit && (
            <span className="text-xs text-fg-subtle">
              You lack users.access — read-only.
            </span>
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
        </div>
      )}
    </div>
  );
}
