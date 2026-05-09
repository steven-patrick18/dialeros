import Link from 'next/link';
import { listCarriers } from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

export default async function CarriersList() {
  const carriers = listCarriers();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Carriers</h1>
        <Link
          href="/carriers/add"
          className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded text-sm"
        >
          + Add Carrier
        </Link>
      </div>

      <p className="text-fg-subtle text-sm mb-6 max-w-2xl">
        SIP trunks for inbound and outbound voice traffic. Each carrier defines
        connection settings, authentication mode, codec preference, and capacity
        limits.
      </p>

      {carriers.length === 0 ? (
        <div className="border border-dashed border-border rounded p-8 text-center max-w-2xl">
          <p className="text-fg-muted">No carriers configured.</p>
          <p className="text-fg-subtle text-sm mt-2">
            Click <span className="font-mono text-fg-muted">+ Add Carrier</span> to
            connect your first SIP trunk.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-fg-subtle border-b border-border">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="font-medium">Host</th>
              <th className="font-medium">Transport</th>
              <th className="font-medium">Auth</th>
              <th className="font-medium">Channels</th>
              <th className="font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {carriers.map((c) => (
              <tr key={c.id} className="border-b border-border/50">
                <td className="py-3">
                  <Link href={`/carriers/${c.id}`} className="hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="font-mono text-fg-muted">
                  {c.host}:{c.port}
                </td>
                <td className="text-fg-muted">{c.transport}</td>
                <td className="text-fg-muted">{c.auth_mode}</td>
                <td className="text-fg-muted tabular-nums">{c.max_channels}</td>
                <td>
                  {c.enabled ? (
                    <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
                      ENABLED
                    </span>
                  ) : (
                    <span className="bg-card-hover/40 text-fg-muted border border-border px-2 py-0.5 rounded text-xs">
                      DISABLED
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
