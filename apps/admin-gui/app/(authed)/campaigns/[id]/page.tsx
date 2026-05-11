import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getActiveAgentsForCampaign,
  getCampaign,
  getCampaignAllowedUserIds,
  getCampaignInGroups,
  getCampaignLeadLists,
  getInGroup,
  getLeadList,
  getRoutePlan,
  getUser,
  hopperSize,
  isCampaignWithinCallWindow,
  leadCountFor,
  listInGroups,
  listLeadLists,
  totalIntentsFor,
} from '@dialeros/control-plane';
import { StatusToggle } from './status-toggle';
import { DeleteCampaignButton } from './delete-button';
import { PacingPanel } from './pacing-panel';
import { VoicemailPanel } from './voicemail-panel';
import { AttachmentPicker } from '@/components/attachment-picker';
import { InlineCardForm } from '@/components/inline-card-form';

export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-success/15 text-success border-success/50',
  paused: 'bg-warn/15 text-warn border-warn/50',
  archived: 'bg-card-hover/40 text-fg-muted border-border',
};

export default async function CampaignDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const c = getCampaign(id);
  if (!c) notFound();

  const routePlan = getRoutePlan(c.route_plan_id);
  const leadListIds = getCampaignLeadLists(id);
  const leadLists = leadListIds.map((lid) => getLeadList(lid)).filter(Boolean);
  const totalLeads = leadLists.reduce(
    (acc, l) => acc + (l ? leadCountFor(l.id) : 0),
    0,
  );
  const activeAgents = getActiveAgentsForCampaign(id);
  const insideWindow = isCampaignWithinCallWindow(c);
  const hopperDepth = hopperSize(id);
  const inGroupIds = getCampaignInGroups(id);
  const inGroups = inGroupIds.map((gid) => getInGroup(gid)).filter(Boolean);
  const isInbound = c.type === 'inbound_queue';

  // Iter 24 — option lists for the inline pickers.
  const allInGroups = listInGroups();
  const allLeadLists = listLeadLists();

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/campaigns"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          ← Campaigns
        </Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">{c.name}</h1>
        <span
          className={`${STATUS_STYLES[c.status] ?? STATUS_STYLES.archived} border px-2 py-0.5 rounded text-xs uppercase`}
        >
          {c.status}
        </span>
      </div>
      <p className="text-fg-subtle text-sm font-mono mb-4">{c.type}</p>

      <div className="max-w-4xl mb-6">
        <InlineCardForm
          title="Description"
          endpoint={`/api/campaigns/${c.id}`}
          fields={[
            {
              type: 'textarea',
              name: 'description',
              label: 'Description',
              value: c.description,
              maxLength: 500,
              placeholder: 'Optional — what this campaign dials, who it serves, etc.',
              hint: 'Free-form notes for other admins. 500 characters max.',
            },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mb-6">
        <Card title="Route plan">
          {routePlan ? (
            <Link
              href={`/route-plans/${routePlan.id}`}
              className="text-sm hover:underline"
            >
              {routePlan.name}
            </Link>
          ) : (
            <p className="text-error text-sm">missing</p>
          )}
        </Card>

        <Card title={`Lead lists (${leadLists.length} attached)`}>
          {leadLists.length === 0 ? (
            <p className="text-fg-subtle text-sm">
              {isInbound
                ? 'Not used — inbound campaigns are driven by in-groups.'
                : 'none — attach below'}
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {leadLists.map((l) =>
                l ? (
                  <li
                    key={l.id}
                    className="flex justify-between items-center"
                  >
                    <Link
                      href={`/leads/${l.id}`}
                      className="hover:underline"
                    >
                      {l.name}
                    </Link>
                    <span className="text-fg-subtle text-xs tabular-nums">
                      {leadCountFor(l.id).toLocaleString()} leads
                    </span>
                  </li>
                ) : null,
              )}
              <li className="pt-2 mt-2 border-t border-border flex justify-between text-xs">
                <span className="text-fg-subtle">Total dialable</span>
                <span className="tabular-nums text-fg">
                  {totalLeads.toLocaleString()}
                </span>
              </li>
            </ul>
          )}
        </Card>

        <InlineCardForm
          title="Pacing"
          endpoint={`/api/campaigns/${c.id}`}
          fields={[
            {
              type: 'select',
              name: 'dial_mode',
              label: 'Dial mode',
              value: c.dial_mode,
              options: [
                {
                  value: 'simulated',
                  label: 'simulated — no real calls (default, safe)',
                },
                {
                  value: 'live',
                  label: 'live — bgapi originate via FreeSWITCH',
                },
              ],
              hint: 'simulated inserts a dial-intent row only — useful for QA, training, traffic shape testing. live calls FreeSWITCH bgapi originate against the route plan\'s primary-carrier gateway. Default is simulated so an active campaign never accidentally places real calls.',
            },
            {
              type: 'number',
              name: 'base_ratio',
              label: 'Base ratio',
              value: c.base_ratio,
              min: 0.5,
              max: 10,
              step: 0.1,
              hint: 'Calls placed per available agent. 1.0 = one call per agent (progressive). Higher = predictive (overdial). 0.5–10.',
            },
            {
              type: 'number',
              name: 'max_abandon_pct',
              label: 'Max abandon %',
              value: c.max_abandon_pct,
              min: 0,
              max: 100,
              step: 0.1,
              hint: 'Maximum % of calls allowed to drop because no agent was free. Predictive pacers throttle when this ceiling is hit. US TCPA compliance is typically ≤3%.',
            },
            {
              type: 'number',
              name: 'dial_level',
              label: 'Dial level',
              value: c.dial_level,
              min: 0.1,
              max: 10,
              step: 0.1,
              hint: 'ViciDial-style multiplier. Per tick the pacer originates floor(active_agents × dial_level) calls. 1.0 = power dial 1:1; 1.5 = predictive 1.5x; 2.0 = aggressive predictive. Combined later with remote-agent line counts.',
            },
            {
              type: 'number',
              name: 'hopper_level',
              label: 'Hopper level',
              value: c.hopper_level,
              min: 1,
              max: 10000,
              step: 1,
              hint: 'How many leads to keep pre-loaded into the campaign hopper. The pacer pops from the hopper each call; refills automatically when it drops below half. Higher = larger pre-fetch buffer; lower = leads picked just-in-time.',
            },
            {
              type: 'select',
              name: 'amd_action',
              label: 'On answer',
              value: c.amd_action,
              options: [
                {
                  value: 'bridge',
                  label: 'bridge — connect the lead to an agent (default)',
                },
                {
                  value: 'detect',
                  label: 'detect — AMD: bridge if human, voicemail/drop if machine',
                },
                {
                  value: 'voicemail',
                  label: 'voicemail — play the uploaded .wav and hang up (voice-blast)',
                },
                {
                  value: 'drop',
                  label: 'drop — hang up at answer (connectivity probing only)',
                },
              ],
              hint: 'Detect mode runs amd_v2 at answer; humans bridge to an agent, machines play the voicemail file (if uploaded) and hang up. Voice-blast = always playback. Drop = always hang up.',
            },
          ]}
          helpText={`Hopper currently holds ${hopperDepth.toLocaleString()} of ${c.hopper_level.toLocaleString()} target leads. Live edits hot-reload into the pacer's per-tick math on the next tick — no service restart.`}
        />

        <VoicemailPanel
          campaignId={c.id}
          amdAction={c.amd_action}
          voicemailPath={c.voicemail_path}
        />

        <InlineCardForm
          title="Compliance"
          endpoint={`/api/campaigns/${c.id}`}
          fields={[
            {
              type: 'time',
              name: 'call_window_start',
              label: 'Call window start',
              value: c.call_window_start,
              hint: 'Earliest local time of day to dial. Leave blank to remove the restriction. Pacer skips ticks outside the window.',
            },
            {
              type: 'time',
              name: 'call_window_end',
              label: 'Call window end',
              value: c.call_window_end,
              hint: 'Latest local time of day. Set later than start for same-day windows, earlier than start to wrap midnight (e.g. 23:00 → 01:00).',
            },
          ]}
          helpText="Both blank = always dial. Both set = honor window. Mixed values are rejected."
        />
      </div>

      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Lead lists attached ({leadLists.length})
        </h2>
        <p className="text-xs text-fg-subtle mb-3">
          Tick a list to attach it. Lists already owned by another campaign
          are marked — checking one moves it here. Save commits the full
          set in one transaction.
        </p>
        <AttachmentPicker
          endpoint={`/api/campaigns/${c.id}/lead-lists`}
          bodyKey="lead_list_ids"
          options={allLeadLists.map((l) => {
            const ownerId = l.campaign_id;
            const inThis = ownerId === c.id;
            const owned = ownerId && !inThis;
            return {
              id: l.id,
              name: l.name,
              hint: owned
                ? `(in another campaign — will move)`
                : !ownerId
                  ? '(unattached)'
                  : undefined,
              warn: !!owned,
            };
          })}
          initialSelected={leadListIds}
          emptyMessage="No lead lists exist yet. Create one from the Lead Lists page first."
        />
      </div>

      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          In-groups attached ({inGroups.length})
        </h2>
        <p className="text-xs text-fg-subtle mb-3">
          Tick the in-groups whose calls land on this campaign. Inbound /
          blended campaigns route incoming calls from these queues to
          attached agents. Save commits the full set.
        </p>
        <AttachmentPicker
          endpoint={`/api/campaigns/${c.id}/in-groups`}
          bodyKey="in_group_ids"
          options={allInGroups.map((g) => ({
            id: g.id,
            name: g.name,
            hint: g.type === 'transfer_only' ? '(transfer-only)' : undefined,
            warn: g.enabled === 0,
          }))}
          initialSelected={inGroupIds}
          emptyMessage="No in-groups exist yet. Create one from the In-Groups page first."
        />
      </div>

      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Status
        </h2>
        <StatusToggle id={c.id} current={c.status} />
        <p className="text-xs text-fg-subtle mt-3">
          ACTIVE starts the pacer (one dial intent every ~3s, round-robin
          across active attached agents). PAUSED / ARCHIVED stops it.
        </p>
        {c.status === 'active' && activeAgents.length === 0 && (
          <p className="bg-warn/10 text-warn border border-warn/50 rounded mt-3 px-3 py-2 text-xs">
            No active agents attached — pacer is running but cannot dial.
            Attach an active agent below to start delivering calls.
          </p>
        )}
        {c.status === 'active' && !insideWindow && (
          <p className="bg-warn/10 text-warn border border-warn/50 rounded mt-3 px-3 py-2 text-xs">
            Outside the configured call window
            {c.call_window_start && c.call_window_end && (
              <>
                {' '}
                ({c.call_window_start}–{c.call_window_end})
              </>
            )}{' '}
            — pacer is ticking but skipping every dial. Calls resume
            automatically when the window opens.
          </p>
        )}
      </div>

      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Dial intents (live)
        </h2>
        <PacingPanel
          campaignId={c.id}
          isActive={c.status === 'active'}
          initialTotal={totalIntentsFor(c.id)}
        />
      </div>

      <AllowedUsersCard
        campaignId={c.id}
        activeAgentCount={activeAgents.length}
      />

      <dl className="grid grid-cols-2 gap-3 text-xs max-w-4xl">
        <Detail label="ID" value={<span className="font-mono">{c.id}</span>} />
        <Detail
          label="Created"
          value={new Date(c.created_at).toLocaleString()}
        />
      </dl>

      <div className="mt-8 max-w-4xl flex items-center gap-4">
        <Link
          href={`/campaigns/${c.id}/edit`}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm"
        >
          Edit campaign
        </Link>
        <DeleteCampaignButton
          id={c.id}
          name={c.name}
          isActive={c.status === 'active'}
        />
      </div>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded p-4 space-y-2">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="text-fg text-right">{value}</dd>
    </div>
  );
}

function AllowedUsersCard({
  campaignId,
  activeAgentCount,
}: {
  campaignId: string;
  activeAgentCount: number;
}) {
  const userIds = getCampaignAllowedUserIds(campaignId);
  const users = userIds.map((id) => getUser(id)).filter(Boolean);
  return (
    <div className="border border-border rounded p-4 mb-6 max-w-4xl">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
        Attached users ({users.length}){' '}
        <span className="text-fg-subtle normal-case tracking-normal ml-1">
          — {activeAgentCount} active agent
          {activeAgentCount === 1 ? '' : 's'} eligible to receive calls
        </span>
      </h2>
      {users.length === 0 ? (
        <p className="text-fg-subtle text-sm">
          No users attached. Edit a user&apos;s detail page to attach them to
          this campaign.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {users.map((u) =>
            u ? (
              <li key={u.id} className="flex items-center gap-3">
                <Link
                  href={`/users/${u.id}`}
                  className="hover:underline"
                >
                  {u.username}
                </Link>
                <span className="text-fg-subtle text-xs uppercase">
                  {u.role}
                </span>
                {u.is_active === 0 && (
                  <span className="bg-error/10 text-error border border-error/50 px-2 py-0.5 rounded text-xs">
                    INACTIVE
                  </span>
                )}
              </li>
            ) : null,
          )}
        </ul>
      )}
    </div>
  );
}
