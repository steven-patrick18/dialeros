import { getCallMenuStats } from '@dialeros/control-plane';

// Iter 155 — per-menu analytics. Reads call_menu_log (populated
// by the iter-153 CUSTOM dialeros::menu_press subscription) and
// shapes it into top-line stats + a per-digit pick-rate table.
//
// Default window = last 7 days. The fs-events listener inserts
// rows on every entry, press, timeout, invalid, and explicit
// completion the dialplan emits, so this card is meaningful as
// soon as real traffic hits the menu.

export function CallMenuAnalyticsCard({ menuId }: { menuId: string }) {
  const since = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = getCallMenuStats(menuId, since);

  const total = rows.reduce((a, r) => a + r.count, 0);
  const entries = rows
    .filter((r) => r.event_type === 'entered')
    .reduce((a, r) => a + r.count, 0);
  const presses = rows
    .filter((r) => r.event_type === 'pressed' && r.digit)
    .reduce((a, r) => a + r.count, 0);
  const timeouts = rows
    .filter((r) => r.event_type === 'timeout')
    .reduce((a, r) => a + r.count, 0);
  const invalids = rows
    .filter((r) => r.event_type === 'invalid')
    .reduce((a, r) => a + r.count, 0);

  const pickRate = entries > 0 ? (presses / entries) * 100 : 0;
  const timeoutRate = entries > 0 ? (timeouts / entries) * 100 : 0;
  const invalidRate = entries > 0 ? (invalids / entries) * 100 : 0;

  // Per-digit breakdown
  const byDigit = new Map<string, number>();
  for (const r of rows) {
    if (r.event_type === 'pressed' && r.digit) {
      byDigit.set(r.digit, (byDigit.get(r.digit) ?? 0) + r.count);
    }
  }
  const digitRows = [...byDigit.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="border border-border rounded p-4 bg-card space-y-3 max-w-3xl mt-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Analytics — last 7 days</h2>
        <span className="text-xs text-fg-subtle">
          {total.toLocaleString()} events / {entries.toLocaleString()} entries
        </span>
      </div>
      {entries === 0 ? (
        <p className="text-fg-subtle text-sm">
          No menu traffic yet. Send a call through the menu to start
          collecting analytics. Every entry, press, timeout, and
          invalid key is logged via the iter-153 fs-events
          subscription to <code>dialeros::menu_press</code>.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Pick rate" value={`${pickRate.toFixed(1)}%`} hint="presses / entries" tone={pickRate > 70 ? 'success' : pickRate > 40 ? 'warn' : 'error'} />
            <Stat label="Timeout rate" value={`${timeoutRate.toFixed(1)}%`} hint="no input within window" tone={timeoutRate > 30 ? 'error' : timeoutRate > 15 ? 'warn' : 'success'} />
            <Stat label="Invalid rate" value={`${invalidRate.toFixed(1)}%`} hint="caller pressed an unmapped digit" tone={invalidRate > 20 ? 'error' : invalidRate > 10 ? 'warn' : 'success'} />
            <Stat label="Total entries" value={entries.toLocaleString()} hint="callers who heard the prompt" tone="muted" />
          </div>

          {digitRows.length > 0 ? (
            <div className="pt-3 border-t border-border">
              <h3 className="text-xs uppercase tracking-wide text-fg-subtle mb-2">
                Digit pick distribution
              </h3>
              <table className="w-full text-sm">
                <thead className="text-fg-subtle text-left">
                  <tr>
                    <th className="py-1.5 w-16">Digit</th>
                    <th className="py-1.5">Distribution</th>
                    <th className="py-1.5 text-right w-24">Count</th>
                    <th className="py-1.5 text-right w-20">%</th>
                  </tr>
                </thead>
                <tbody>
                  {digitRows.map(([digit, count]) => (
                    <tr key={digit} className="border-t border-border">
                      <td className="py-1.5 font-mono text-base">{digit}</td>
                      <td className="py-1.5">
                        <div className="bg-card-hover/30 rounded h-3 relative">
                          <div
                            className="bg-accent rounded h-3"
                            style={{
                              width: `${(count / presses) * 100}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {count.toLocaleString()}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-fg-subtle">
                        {((count / presses) * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: 'success' | 'warn' | 'error' | 'muted';
}) {
  const cls = {
    success: 'text-success',
    warn: 'text-warn',
    error: 'text-error',
    muted: 'text-fg',
  }[tone];
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className={`text-xl font-semibold tabular-nums ${cls}`}>
        {value}
      </div>
      <div className="text-[10px] text-fg-subtle">{hint}</div>
    </div>
  );
}
