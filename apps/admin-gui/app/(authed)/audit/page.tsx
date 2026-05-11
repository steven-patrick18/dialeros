import Link from 'next/link';
import {
  getUserById,
  getUserByUsername,
  queryAuditFiltered,
  queryAuditTargetTypes,
  type AuditEventRecord,
} from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

// Iter 76 — color tier per domain prefix. Anything not listed falls
// through to neutral. Destructive verbs are highlighted regardless.
const DOMAIN_COLORS: Record<string, string> = {
  user: 'text-accent',
  node: 'text-info',
  campaign: 'text-fg',
  route_plan: 'text-fg',
  carrier: 'text-fg',
  cid_group: 'text-fg',
  in_group: 'text-fg',
  lead: 'text-fg',
  did: 'text-fg',
  phone: 'text-fg',
  remote_agent: 'text-fg',
  dnc: 'text-warn',
  setup: 'text-accent',
};

function actionColor(action: string): string {
  const verb = action.split('.', 2)[1] ?? '';
  if (
    verb === 'deleted' ||
    verb === 'login_failure' ||
    verb === 'removed' ||
    verb === 'hopper_reset'
  ) {
    return 'text-error';
  }
  const domain = action.split('.', 1)[0] ?? '';
  return DOMAIN_COLORS[domain] ?? 'text-fg';
}

/** "campaign.hopper_reset" → "Campaign · hopper reset" */
function actionLabel(action: string): string {
  const [domain = '', verb = ''] = action.split('.', 2);
  const niceDomain = domain
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  const niceVerb = verb.replace(/_/g, ' ');
  return verb ? `${niceDomain} · ${niceVerb}` : niceDomain;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    action?: string;
    actor?: string;
    target_type?: string;
    before?: string;
  }>;
}) {
  const sp = await searchParams;
  const actionPrefix = sp.action?.trim() || null;
  const actorUsername = sp.actor?.trim() || null;
  const targetType = sp.target_type?.trim() || null;
  const before = sp.before?.trim() || null;

  // Resolve the actor username -> id so the filter takes a friendly
  // input but hits the indexed actor_user_id column.
  let actorUserId: string | null = null;
  let actorNotFound = false;
  if (actorUsername) {
    const u = getUserByUsername(actorUsername);
    if (u) actorUserId = u.id;
    else actorNotFound = true;
  }

  const events = actorNotFound
    ? []
    : queryAuditFiltered({
        limit: PAGE_SIZE + 1, // +1 to detect a next page
        actionPrefix,
        actorUserId,
        targetType,
        beforeTs: before,
      });
  const hasMore = events.length > PAGE_SIZE;
  const pageEvents = hasMore ? events.slice(0, PAGE_SIZE) : events;

  // Pre-resolve actor usernames in one pass.
  const actorIds = Array.from(
    new Set(pageEvents.map((e) => e.actor_user_id).filter(Boolean) as string[]),
  );
  const actorNames = new Map<string, string>();
  for (const id of actorIds) {
    const u = getUserById(id);
    if (u) actorNames.set(id, u.username);
  }

  const targetTypeOptions = queryAuditTargetTypes();

  // Build the "Older" URL by using the last row's ts as the cursor.
  const lastTs = pageEvents[pageEvents.length - 1]?.ts ?? null;
  const olderHref = lastTs && hasMore ? buildHref(sp, { before: lastTs }) : null;
  // "Newer" rewinds to the first page (drops `before`).
  const newerHref = before ? buildHref(sp, { before: undefined }) : null;
  const clearHref = '/audit';
  const hasFilter = !!(actionPrefix || actorUsername || targetType || before);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Audit Log</h1>
      <p className="text-fg-subtle text-sm mb-4">
        Append-only record of every privileged action. Filter, paginate,
        and scroll the most recent {PAGE_SIZE} matches at a time.
      </p>

      <form
        className="flex flex-wrap items-end gap-3 mb-4 border border-border rounded p-3 max-w-5xl"
        method="GET"
      >
        <Field label="Action prefix" hint="e.g. campaign or cid_group.">
          <input
            name="action"
            defaultValue={actionPrefix ?? ''}
            placeholder="campaign"
            className="input text-sm w-44"
            autoComplete="off"
          />
        </Field>
        <Field label="Actor username">
          <input
            name="actor"
            defaultValue={actorUsername ?? ''}
            placeholder="admin"
            className="input text-sm w-44"
            autoComplete="off"
          />
        </Field>
        <Field label="Target type">
          <select
            name="target_type"
            defaultValue={targetType ?? ''}
            className="input text-sm w-44"
          >
            <option value="">— any —</option>
            {targetTypeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-center gap-2 pb-0.5">
          <button
            type="submit"
            className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm"
          >
            Apply
          </button>
          {hasFilter && (
            <Link
              href={clearHref}
              className="text-xs px-3 py-1.5 rounded border border-border text-fg-muted hover:text-fg"
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      {actorNotFound && (
        <div className="border border-warn/40 bg-warn/10 rounded p-3 text-sm text-warn mb-4 max-w-5xl">
          No user matches{' '}
          <span className="font-mono">{actorUsername}</span>. Showing 0
          rows.
        </div>
      )}

      {pageEvents.length === 0 && !actorNotFound ? (
        <p className="text-fg-subtle text-sm">
          No audit events {hasFilter ? 'match the filter' : 'yet'}.
        </p>
      ) : (
        <div className="border border-border rounded overflow-hidden max-w-5xl">
          <table className="w-full text-sm">
            <thead className="text-left text-fg-subtle bg-card/70">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {pageEvents.map((e) => (
                <Row key={e.id} event={e} actorNames={actorNames} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(newerHref || olderHref) && (
        <div className="mt-3 max-w-5xl flex items-center gap-3 text-sm">
          {newerHref ? (
            <Link
              href={newerHref}
              className="text-xs px-3 py-1.5 rounded border border-border text-fg-muted hover:text-fg"
            >
              ← Newer
            </Link>
          ) : (
            <span className="text-xs px-3 py-1.5 rounded border border-border text-fg-subtle/50">
              ← Newer
            </span>
          )}
          {olderHref ? (
            <Link
              href={olderHref}
              className="text-xs px-3 py-1.5 rounded border border-border text-fg-muted hover:text-fg"
            >
              Older →
            </Link>
          ) : (
            <span className="text-xs px-3 py-1.5 rounded border border-border text-fg-subtle/50">
              Older →
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs text-fg-subtle mb-1 flex items-center gap-2">
        <span>{label}</span>
        {hint && <span className="text-fg-subtle/70 italic">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

function Row({
  event,
  actorNames,
}: {
  event: AuditEventRecord;
  actorNames: Map<string, string>;
}) {
  const color = actionColor(event.action);
  const label = actionLabel(event.action);
  const actor = event.actor_user_id
    ? (actorNames.get(event.actor_user_id) ?? event.actor_user_id.slice(0, 8))
    : '—';
  const ipSuffix = event.actor_ip ? ` · ${event.actor_ip}` : '';

  let payload: Record<string, unknown> | null = null;
  if (event.payload_json) {
    try {
      payload = JSON.parse(event.payload_json) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }

  return (
    <tr className="border-t border-border/50 align-top">
      <td className="px-3 py-2 text-fg-subtle font-mono text-xs whitespace-nowrap">
        {formatTime(event.ts)}
      </td>
      <td className={`px-3 py-2 ${color}`}>
        <div>{label}</div>
        <div className="text-fg-subtle text-[10px] font-mono">
          {event.action}
        </div>
      </td>
      <td className="px-3 py-2 text-fg-muted text-xs">
        {actor}
        <span className="text-fg-subtle">{ipSuffix}</span>
      </td>
      <td className="px-3 py-2 text-fg-muted text-xs font-mono">
        {event.target_type ?? '—'}
        {event.target_id && (
          <span className="text-fg-subtle"> · {event.target_id.slice(0, 8)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-fg-muted text-xs font-mono break-all">
        {payload ? formatPayload(payload) : '—'}
      </td>
    </tr>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function formatPayload(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(' ');
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') {
    return v.length > 64 ? v.slice(0, 61) + '…' : v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return '—';
  const json = JSON.stringify(v);
  return json.length > 64 ? json.slice(0, 61) + '…' : json;
}

function buildHref(
  current: { action?: string; actor?: string; target_type?: string },
  patch: { before?: string | undefined },
): string {
  const params = new URLSearchParams();
  if (current.action) params.set('action', current.action);
  if (current.actor) params.set('actor', current.actor);
  if (current.target_type) params.set('target_type', current.target_type);
  if (patch.before !== undefined) params.set('before', patch.before);
  const qs = params.toString();
  return qs ? `/audit?${qs}` : '/audit';
}
