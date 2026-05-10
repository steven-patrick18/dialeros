import Link from 'next/link';
import {
  auditCountsByAction,
  dialIntentsByHour,
  globalLeadStatusBreakdown,
  listLeadLists,
  loginActivityRollup,
  topCampaignsByIntents,
  totalDialIntents,
} from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const intentsTotal24h = totalDialIntents(since24);
  const intentsTotal7d = totalDialIntents(since7d);
  const intentsByHour = dialIntentsByHour(since24);
  const leadStatuses = globalLeadStatusBreakdown();
  const topCampaigns = topCampaignsByIntents(since24, 5);
  const auditCounts = auditCountsByAction(since24);
  const loginActivity = loginActivityRollup(since24);
  const leadLists = listLeadLists();

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Reports</h1>
      <p className="text-fg-subtle text-sm mb-6">
        Live aggregates over the past 24 hours. Refresh to update.
      </p>

      {/* Top stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mb-6">
        <Stat
          label="Dial intents — 24h"
          value={intentsTotal24h.toLocaleString()}
          accent={intentsTotal24h > 0 ? 'text-success' : 'text-fg'}
        />
        <Stat
          label="Dial intents — 7d"
          value={intentsTotal7d.toLocaleString()}
        />
        <Stat
          label="Lead lists"
          value={leadLists.length.toLocaleString()}
        />
        <Stat
          label="Total leads"
          value={leadStatuses
            .reduce((acc, s) => acc + s.count, 0)
            .toLocaleString()}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">
        <Panel title="Dial intents by hour (last 24h)">
          {intentsByHour.length === 0 ? (
            <p className="text-fg-subtle text-sm">No dialing activity.</p>
          ) : (
            <HourlyBars data={intentsByHour} />
          )}
        </Panel>

        <Panel title="Lead pipeline (all lists)">
          {leadStatuses.length === 0 ? (
            <p className="text-fg-subtle text-sm">No leads ingested yet.</p>
          ) : (
            <BreakdownBars
              data={leadStatuses.map((s) => ({
                label: s.status,
                count: s.count,
              }))}
            />
          )}
        </Panel>

        <Panel title="Top campaigns — last 24h">
          {topCampaigns.length === 0 ? (
            <p className="text-fg-subtle text-sm">No campaigns yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-fg-subtle border-b border-border">
                <tr>
                  <th className="py-2 font-medium">Campaign</th>
                  <th className="font-medium">Status</th>
                  <th className="font-medium tabular-nums text-right">
                    Intents
                  </th>
                </tr>
              </thead>
              <tbody>
                {topCampaigns.map((c) => (
                  <tr
                    key={c.campaign_id}
                    className="border-b border-border/50"
                  >
                    <td className="py-2">
                      <Link
                        href={`/campaigns/${c.campaign_id}`}
                        className="hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="text-fg-muted text-xs uppercase">
                      {c.status}
                    </td>
                    <td className="text-fg tabular-nums text-right">
                      {c.intents.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Audit activity by action — last 24h">
          {auditCounts.length === 0 ? (
            <p className="text-fg-subtle text-sm">No audit events.</p>
          ) : (
            <BreakdownBars
              data={auditCounts.map((a) => ({
                label: a.action,
                count: a.count,
              }))}
            />
          )}
        </Panel>

        <Panel title="Login activity by user — last 24h">
          {loginActivity.length === 0 ? (
            <p className="text-fg-subtle text-sm">No login attempts.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-fg-subtle border-b border-border">
                <tr>
                  <th className="py-2 font-medium">User</th>
                  <th className="font-medium tabular-nums text-right">OK</th>
                  <th className="font-medium tabular-nums text-right">
                    Failed
                  </th>
                </tr>
              </thead>
              <tbody>
                {loginActivity.map((u) => (
                  <tr key={u.username} className="border-b border-border/50">
                    <td className="py-2 font-mono text-xs">{u.username}</td>
                    <td className="text-success tabular-nums text-right">
                      {u.success}
                    </td>
                    <td
                      className={`tabular-nums text-right ${
                        u.failure > 0 ? 'text-error' : 'text-fg-subtle'
                      }`}
                    >
                      {u.failure}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded p-4">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  accent = 'text-fg',
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="border border-border rounded p-4">
      <div className="text-xs text-fg-subtle uppercase">{label}</div>
      <div className={`text-2xl mt-1 tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function HourlyBars({
  data,
}: {
  data: Array<{ hour: string; count: number }>;
}) {
  // Fill in missing hours so the chart shows the full 24h shape.
  const map = new Map(data.map((d) => [d.hour, d.count]));
  const now = new Date();
  const hours: Array<{ hour: string; count: number; label: string }> = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'
    const hourLabel = String(d.getHours()).padStart(2, '0');
    hours.push({
      hour: key,
      count: map.get(key) ?? 0,
      label: hourLabel,
    });
  }
  const max = Math.max(1, ...hours.map((h) => h.count));

  return (
    <div className="space-y-1">
      {hours.map((h) => (
        <div key={h.hour} className="flex items-center gap-2 text-xs">
          <span className="text-fg-subtle font-mono w-8 tabular-nums">
            {h.label}h
          </span>
          <div className="flex-1 bg-card-hover/30 rounded relative h-4">
            {h.count > 0 && (
              <div
                className="bg-accent rounded h-4"
                style={{ width: `${(h.count / max) * 100}%` }}
              />
            )}
          </div>
          <span className="text-fg tabular-nums w-10 text-right">
            {h.count}
          </span>
        </div>
      ))}
    </div>
  );
}

function BreakdownBars({
  data,
}: {
  data: Array<{ label: string; count: number }>;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3 text-xs">
          <span className="text-fg-muted font-mono w-44 truncate">
            {d.label}
          </span>
          <div className="flex-1 bg-card-hover/30 rounded relative h-4">
            <div
              className="bg-accent rounded h-4"
              style={{ width: `${(d.count / max) * 100}%` }}
            />
          </div>
          <span className="text-fg tabular-nums w-12 text-right">
            {d.count.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
