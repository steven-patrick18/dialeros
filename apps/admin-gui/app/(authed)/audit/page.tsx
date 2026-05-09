import {
  getUserById,
  queryAudit,
  type AuditEventRecord,
} from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

const ACTION_LABELS: Record<string, string> = {
  'user.created': 'User created',
  'user.login_success': 'Login',
  'user.login_failure': 'Failed login',
  'user.logout': 'Logout',
  'user.password_changed': 'Password changed',
  'user.role_changed': 'Role changed',
  'node.created': 'Node added',
  'node.status_changed': 'Node status changed',
  'node.deleted': 'Node deleted',
};

const ACTION_COLORS: Record<string, string> = {
  'user.login_failure': 'text-error',
  'node.deleted': 'text-error',
};

export default async function AuditPage() {
  const events = queryAudit(200);

  // Pre-resolve actor usernames in one pass.
  const actorIds = Array.from(
    new Set(events.map((e) => e.actor_user_id).filter(Boolean) as string[]),
  );
  const actorNames = new Map<string, string>();
  for (const id of actorIds) {
    const u = getUserById(id);
    if (u) actorNames.set(id, u.username);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Audit Log</h1>
      <p className="text-fg-subtle text-sm mb-6">
        Append-only record of every privileged action. Most recent 200 events.
      </p>

      {events.length === 0 ? (
        <p className="text-fg-subtle text-sm">No audit events yet.</p>
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
              {events.map((e) => (
                <Row key={e.id} event={e} actorNames={actorNames} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({
  event,
  actorNames,
}: {
  event: AuditEventRecord;
  actorNames: Map<string, string>;
}) {
  const label = ACTION_LABELS[event.action] ?? event.action;
  const color = ACTION_COLORS[event.action] ?? 'text-fg';
  const actor = event.actor_user_id
    ? (actorNames.get(event.actor_user_id) ?? event.actor_user_id.slice(0, 8))
    : 'â€”';
  const ipSuffix = event.actor_ip ? ` Â· ${event.actor_ip}` : '';

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
      <td className={`px-3 py-2 ${color}`}>{label}</td>
      <td className="px-3 py-2 text-fg-muted text-xs">
        {actor}
        <span className="text-fg-subtle">{ipSuffix}</span>
      </td>
      <td className="px-3 py-2 text-fg-muted text-xs font-mono">
        {event.target_type ?? 'â€”'}
        {event.target_id && (
          <span className="text-fg-subtle"> Â· {event.target_id.slice(0, 8)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-fg-muted text-xs font-mono">
        {payload ? formatPayload(payload) : 'â€”'}
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
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return 'â€”';
  return JSON.stringify(v);
}
