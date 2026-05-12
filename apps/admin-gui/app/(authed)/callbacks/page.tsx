import Link from 'next/link';
import { listScheduledCallbacks } from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

// Iter 104 — supervisor view of every scheduled callback. The
// pacer's schedule-aware picker (iter 19) already prioritizes
// these in priority order (overdue first); this is the read
// surface so the supervisor can see what's queued, what's
// overdue, and intervene if needed (reassign campaign, drop the
// callback, dispatch an agent manually).

const HOUR_MS = 60 * 60 * 1000;

export default async function CallbacksPage() {
  const rows = listScheduledCallbacks(500);
  const now = Date.now();
  const overdue = rows.filter((r) => Date.parse(r.callback_at) <= now);
  const nextHour = rows.filter((r) => {
    const t = Date.parse(r.callback_at);
    return t > now && t <= now + HOUR_MS;
  });
  const later = rows.filter((r) => Date.parse(r.callback_at) > now + HOUR_MS);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Callbacks</h1>
      <p className="text-fg-muted text-sm mb-6">
        Scheduled callbacks across every campaign. The pacer dials
        these first — overdue rows are already in line for the next
        available agent.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mb-6">
        <Stat
          label="Overdue"
          value={overdue.length}
          tone={overdue.length > 0 ? 'error' : 'muted'}
          hint="Callback time has passed — pacer is dialing these now"
        />
        <Stat
          label="Next hour"
          value={nextHour.length}
          tone={nextHour.length > 0 ? 'warn' : 'muted'}
          hint="Due within the next 60 minutes"
        />
        <Stat
          label="Later"
          value={later.length}
          tone={later.length > 0 ? 'fg' : 'muted'}
          hint="Scheduled beyond the next hour"
        />
        <Stat
          label="Total"
          value={rows.length}
          tone={rows.length > 0 ? 'accent' : 'muted'}
          hint={
            rows.length >= 500
              ? 'Showing first 500 (sorted oldest-first)'
              : 'Every CALLBACK_SCHEDULED lead on the floor'
          }
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-fg-subtle text-sm">
          No callbacks scheduled. Agents create these by picking the
          CALLBACK disposition during wrap-up.
        </p>
      ) : (
        <div className="border border-border rounded overflow-hidden max-w-5xl">
          <table className="w-full text-sm">
            <thead className="text-left text-fg-subtle border-b border-border bg-card-hover/30">
              <tr>
                <th className="py-2 px-3 font-medium">Due</th>
                <th className="font-medium">Lead</th>
                <th className="font-medium">List</th>
                <th className="font-medium">Timezone</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const due = Date.parse(r.callback_at);
                const dueLabel = formatDue(due, now);
                const dueTone =
                  due <= now
                    ? 'text-error'
                    : due <= now + HOUR_MS
                      ? 'text-warn'
                      : 'text-fg-muted';
                return (
                  <tr
                    key={r.lead_id}
                    className="border-b border-border/40"
                  >
                    <td className="py-2 px-3 whitespace-nowrap">
                      <div className={`tabular-nums ${dueTone}`}>
                        {dueLabel}
                      </div>
                      <div className="text-[10px] text-fg-subtle font-mono">
                        {new Date(r.callback_at).toLocaleString()}
                      </div>
                    </td>
                    <td>
                      <Link
                        href={`/leads/lead/${r.lead_id}`}
                        className="hover:underline font-mono"
                      >
                        {r.phone}
                      </Link>
                      {r.lead_name && (
                        <div className="text-fg-subtle text-xs">
                          {r.lead_name}
                        </div>
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/leads/${r.list_id}`}
                        className="hover:underline text-fg-muted"
                      >
                        {r.list_name}
                      </Link>
                    </td>
                    <td className="text-fg-subtle font-mono text-xs">
                      {r.timezone ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatDue(dueMs: number, nowMs: number): string {
  const diff = dueMs - nowMs;
  const past = diff < 0;
  const abs = Math.abs(diff);
  const sec = Math.floor(abs / 1000);
  if (sec < 60) return past ? `${sec}s ago` : `in ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return past ? `${min}m ago` : `in ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    const m = min % 60;
    const label = m > 0 ? `${hr}h${m}m` : `${hr}h`;
    return past ? `${label} ago` : `in ${label}`;
  }
  const day = Math.floor(hr / 24);
  return past ? `${day}d ago` : `in ${day}d`;
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: 'success' | 'warn' | 'error' | 'accent' | 'fg' | 'muted';
  hint: string;
}) {
  const colour = {
    success: 'text-success',
    warn: 'text-warn',
    error: 'text-error',
    accent: 'text-accent',
    fg: 'text-fg',
    muted: 'text-fg-muted',
  }[tone];
  return (
    <div
      title={hint}
      className="border border-border rounded p-3 cursor-help"
    >
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className={`text-2xl mt-1 tabular-nums ${colour}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
