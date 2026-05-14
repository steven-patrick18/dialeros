import { redirect } from 'next/navigation';
import {
  getLatestBackupVerification,
  listBackupVerifications,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { TriggerButton } from './trigger-button';

export const dynamic = 'force-dynamic';

// Iter 170 — Backups page. Read-only history view + a trigger
// button that systemctl-starts dialeros-backup-verify.service.
// Admin + supervisor.

function statusTone(status: string): string {
  if (status === 'ok') return 'text-success';
  if (status === 'no_backup') return 'text-warn';
  return 'text-error';
}

function fmtBytes(n: number | null | undefined): string {
  if (!n) return '—';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

export default async function BackupsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Backups</h1>
        <p className="text-error text-sm">
          Admin or supervisor role required.
        </p>
      </div>
    );
  }

  const latest = JSON.parse(
    JSON.stringify(getLatestBackupVerification() ?? null),
  );
  const history = JSON.parse(JSON.stringify(listBackupVerifications(30)));

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold mb-1">Backups</h1>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        The iter-112 nightly job (
        <code className="text-xs">dialeros-backup.timer</code>,
        02:00 UTC) snapshots the live sqlite DB into{' '}
        <code className="text-xs">/var/backups/dialeros</code>.
        The iter-170 weekly verifier (
        <code className="text-xs">dialeros-backup-verify.timer</code>,
        Sunday 03:00 UTC) restores the latest snapshot to a temp
        file, runs <code className="text-xs">PRAGMA integrity_check</code>{' '}
        + core-table presence + row counts, and writes a row to
        this table. Backups you&apos;ve never restored aren&apos;t
        backups.
      </p>

      <section className="mb-6">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Latest verification
        </h2>
        {latest ? (
          <div className="border border-border rounded p-4 bg-card">
            <div className="flex items-baseline justify-between mb-3">
              <span
                className={`text-lg font-semibold ${statusTone(latest.status)}`}
              >
                {latest.status === 'ok'
                  ? '● OK'
                  : `✕ ${latest.status}`}
              </span>
              <span className="text-xs text-fg-subtle">
                {new Date(latest.ts).toLocaleString()}
              </span>
            </div>
            {latest.error_msg ? (
              <p className="text-error text-sm mb-2">
                {latest.error_msg}
              </p>
            ) : null}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <Stat label="users" value={latest.users_count} />
              <Stat label="campaigns" value={latest.campaigns_count} />
              <Stat label="dial_intents" value={latest.intents_count} />
              <Stat label="leads" value={latest.leads_count} />
              <Stat
                label="size"
                value={fmtBytes(latest.size_bytes)}
              />
              <Stat
                label="latest intent ts"
                value={
                  latest.latest_intent_ts
                    ? new Date(latest.latest_intent_ts).toLocaleString()
                    : '—'
                }
              />
            </div>
            {latest.source_path ? (
              <p className="text-[10px] font-mono text-fg-subtle mt-2 break-all">
                {latest.source_path}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="border border-border rounded p-4 bg-card text-fg-subtle text-sm">
            No verifications yet. Click &quot;Run verify now&quot;
            below or wait for Sunday&apos;s scheduled run.
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Trigger
        </h2>
        <TriggerButton canTrigger={me.role === 'admin'} />
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          History
        </h2>
        {history.length === 0 ? (
          <p className="text-fg-subtle text-sm">No history yet.</p>
        ) : (
          <div className="overflow-x-auto border border-border rounded">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated text-fg-subtle text-left text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Size</th>
                  <th className="px-3 py-2">Intents</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {history.map(
                  (h: {
                    id: number;
                    ts: string;
                    status: string;
                    size_bytes: number | null;
                    intents_count: number | null;
                    source_path: string | null;
                    error_msg: string | null;
                  }) => (
                    <tr key={h.id} className="border-t border-border">
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {new Date(h.ts).toLocaleString()}
                      </td>
                      <td className={`px-3 py-2 ${statusTone(h.status)}`}>
                        {h.status}
                        {h.error_msg ? (
                          <span className="block text-[10px] text-fg-subtle truncate max-w-xs">
                            {h.error_msg}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums">
                        {fmtBytes(h.size_bytes)}
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums">
                        {h.intents_count?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-[10px] font-mono text-fg-subtle truncate max-w-xs">
                        {h.source_path ?? '—'}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className="text-sm tabular-nums">
        {value == null ? '—' : String(value)}
      </div>
    </div>
  );
}
