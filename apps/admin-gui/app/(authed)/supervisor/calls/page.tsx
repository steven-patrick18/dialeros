import { redirect } from 'next/navigation';
import {
  listCampaigns,
  listUsers,
  listFloorCallHistory,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { CallsList } from './calls-list';

export const dynamic = 'force-dynamic';

// Iter 142 — Floor call history. Supervisor + admin only. Server
// renders the initial last-24h slice + the filter option lists
// (campaigns, agents); the CallsList client component re-queries
// /api/supervisor/calls when filters change without a full nav.
//
// Recording playback piggybacks on the iter-55 /api/recordings/[id]
// endpoint which already does authz + Range support.
//
// Iter 141 made VM-drop recordings start AFTER the beep, so the
// rows shown here that came from amd_action=voicemail/detect have
// .wav files that are JUST the dropped message or live conversation
// — no more wading past the machine greeting.
export default async function FloorCallsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Floor calls</h1>
        <p className="text-error text-sm">
          Admin or supervisor role required.
        </p>
      </div>
    );
  }

  // Last 24h as the default slice — matches /api/supervisor/calls.
  const sinceIso = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();
  const initialRows = JSON.parse(
    JSON.stringify(
      listFloorCallHistory({ sinceIso, limit: 200 }),
    ),
  );

  // Option lists for the filter form. Agents = non-admin users
  // (supervisors can still answer calls in this product) so we
  // include all roles other than admin to keep the dropdown short.
  const campaigns = listCampaigns().map((c) => ({
    id: c.id,
    name: c.name,
  }));
  const agents = listUsers(false)
    .filter((u) => u.role !== 'admin')
    .map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.display_name ?? null,
    }));

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Floor calls</h1>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        Every outbound and inbound call across the floor for the
        selected window. Filter by campaign, agent, disposition, or
        AMD result; play the recording inline. Defaults to the last
        24 hours. Simulated rows are hidden.
      </p>
      <CallsList
        initialRows={initialRows}
        campaigns={campaigns}
        agents={agents}
        defaultSinceIso={sinceIso}
      />
    </div>
  );
}
