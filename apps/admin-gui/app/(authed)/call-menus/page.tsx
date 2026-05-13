import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  listCallMenus,
  getCallMenuOptions,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Iter 149 — Call Menus list. Admin only. Shows each menu with
// option count + default action so an operator gets a sense of
// menu shape without clicking through.
//
// "Wire status" column flags whether the menu is referenced by any
// DID / in-group / campaign — that wiring lands in iter 151.
// Until then every menu shows "not wired".

export default async function CallMenusPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Call Menus</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const menus = listCallMenus();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Call Menus (IVR)</h1>
        <Link
          href="/call-menus/add"
          className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm"
        >
          New menu
        </Link>
      </div>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        DTMF menus for inbound flows. Each menu plays a prompt,
        listens for a digit, and routes to the matched destination
        (in-group, extension, voicemail, another menu, DID, or
        hangup). Menus can be wired as the entry point of a DID,
        the overflow / after-hours target of an in-group, or the
        no-agent drop target of an outbound campaign — those
        connection forms ship in iter 151.
      </p>

      {menus.length === 0 ? (
        <p className="text-fg-subtle text-sm">
          No call menus defined yet. Create one to get started.
        </p>
      ) : (
        <div className="overflow-x-auto border border-border rounded-md max-w-5xl">
          <table className="w-full text-sm">
            <thead className="bg-bg-elevated text-fg-subtle text-left">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Options</th>
                <th className="px-3 py-2">Default</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {menus.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link
                      href={`/call-menus/${m.id}`}
                      className="text-link hover:underline font-medium"
                    >
                      {m.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-fg-subtle">
                    {m.description || '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {getCallMenuOptions(m.id).length}
                  </td>
                  <td className="px-3 py-2 text-fg-subtle text-xs">
                    {m.default_action_type}
                    {m.default_action_value
                      ? ` → ${m.default_action_value}`
                      : ''}
                  </td>
                  <td className="px-3 py-2 text-fg-subtle text-xs whitespace-nowrap">
                    {new Date(m.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
