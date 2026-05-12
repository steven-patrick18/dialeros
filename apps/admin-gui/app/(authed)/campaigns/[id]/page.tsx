import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  amdBreakdownForCampaignToday,
  campaignDispositionMix,
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
  isUserRegistered,
  leadCountFor,
  listInGroups,
  listLeadLists,
  listRemoteAgentsWithCapacity,
  parseDialableStatuses,
  totalIntentsFor,
} from '@dialeros/control-plane';
import { StatusToggle } from './status-toggle';
import { DeleteCampaignButton } from './delete-button';
import { CloneCampaignButton } from './clone-button';
import { AnswerRateCard } from './answer-rate-card';
import { PacingPanel } from './pacing-panel';
import { VoicemailPanel } from './voicemail-panel';
import { HopperResetButton } from './hopper-reset-button';
import { CampaignTabs, parseCampaignTab } from './campaign-tabs';
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = parseCampaignTab(rawTab);

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
  // Iter 73 / 82 — pool size for the warning banners. We need both:
  //   remoteCapacity   = sum of AVAILABLE lines right now (lines -
  //                      in-flight). Used for the per-tick math.
  //   remoteLinesTotal = sum of CONFIGURED lines across attached
  //                      remote agents, regardless of how many are
  //                      currently busy. Lets us distinguish
  //                      "no remote assigned" (truly no agents) from
  //                      "remote saturated" (assigned but every line
  //                      is in-flight) — two very different banners.
  const remoteSlots = listRemoteAgentsWithCapacity(id);
  const remoteCapacity = remoteSlots.reduce((s, r) => s + r.available, 0);
  const remoteLinesTotal = remoteSlots.reduce(
    (s, r) => s + r.agent.lines,
    0,
  );
  const remoteInFlight = remoteLinesTotal - remoteCapacity;

  // Iter 88 — for bridge / detect amd_actions the call only succeeds
  // if SOMETHING is registered at the bridge target. Probe each
  // attached remote agent's SIP user@host against FS's
  // sofia_contact — surfaces "USER_NOT_REGISTERED" as a banner so
  // the operator doesn't waste hours wondering why "bridge" mode
  // fires originates but nothing answers.
  const unregisteredRemotes: Array<{
    name: string;
    sip_uri: string;
  }> = [];
  if (c.amd_action === 'bridge' || c.amd_action === 'detect') {
    await Promise.all(
      remoteSlots.map(async ({ agent }) => {
        const m = agent.sip_uri.match(/^sip:([^@]+)@(.+)$/i);
        if (!m) return;
        const [, user, host] = m;
        const registered = await isUserRegistered(user!, host!);
        if (!registered) {
          unregisteredRemotes.push({
            name: agent.name,
            sip_uri: agent.sip_uri,
          });
        }
      }),
    );
  }
  const insideWindow = isCampaignWithinCallWindow(c);
  const hopperDepth = hopperSize(id);
  // Iter 94 — whitelist of lead statuses the pacer will dial.
  // Surfaces in the Advanced pacing card on the Detail tab.
  const dialableStatuses = parseDialableStatuses(c);
  const inGroupIds = getCampaignInGroups(id);
  const inGroups = inGroupIds.map((gid) => getInGroup(gid)).filter(Boolean);
  const isInbound = c.type === 'inbound_queue';
  const allInGroups = listInGroups();
  const allLeadLists = listLeadLists();
  const dispoMix = campaignDispositionMix(id);

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
        <div className="flex items-center gap-3">
          <CloneCampaignButton campaignId={c.id} defaultName={c.name} />
          <span
            className={`${STATUS_STYLES[c.status] ?? STATUS_STYLES.archived} border px-2 py-0.5 rounded text-xs uppercase`}
          >
            {c.status}
          </span>
        </div>
      </div>
      <p className="text-fg-subtle text-sm font-mono mb-4">{c.type}</p>

      <CampaignTabs id={c.id} active={tab} />

      {tab === 'basic' && (
        <BasicTab
          c={c}
          routePlan={routePlan}
          leadLists={leadLists}
          totalLeads={totalLeads}
          isInbound={isInbound}
          hopperDepth={hopperDepth}
          activeAgents={activeAgents}
          remoteCapacity={remoteCapacity}
          remoteLinesTotal={remoteLinesTotal}
          remoteInFlight={remoteInFlight}
          unregisteredRemotes={unregisteredRemotes}
          insideWindow={insideWindow}
          dispoMix={dispoMix}
        />
      )}

      {tab === 'detail' && (
        <DetailTab
          c={c}
          activeAgents={activeAgents}
          dialableStatuses={dialableStatuses}
        />
      )}

      {tab === 'list-mix' && (
        <ListMixTab
          c={c}
          leadListIds={leadListIds}
          allLeadLists={allLeadLists}
          inGroupIds={inGroupIds}
          allInGroups={allInGroups}
        />
      )}

      {tab === 'realtime' && (
        <RealtimeTab
          c={c}
          activeAgents={activeAgents.length}
          remoteCapacity={remoteCapacity}
          remoteLinesTotal={remoteLinesTotal}
          remoteInFlight={remoteInFlight}
        />
      )}
    </div>
  );
}

function BasicTab({
  c,
  routePlan,
  leadLists,
  totalLeads,
  isInbound,
  hopperDepth,
  activeAgents,
  remoteCapacity,
  remoteLinesTotal,
  remoteInFlight,
  unregisteredRemotes,
  insideWindow,
  dispoMix,
}: {
  c: ReturnType<typeof getCampaign> & {};
  routePlan: ReturnType<typeof getRoutePlan>;
  leadLists: (ReturnType<typeof getLeadList> | null | undefined)[];
  totalLeads: number;
  isInbound: boolean;
  hopperDepth: number;
  activeAgents: ReturnType<typeof getActiveAgentsForCampaign>;
  remoteCapacity: number;
  remoteLinesTotal: number;
  remoteInFlight: number;
  unregisteredRemotes: Array<{ name: string; sip_uri: string }>;
  insideWindow: boolean;
  dispoMix: ReturnType<typeof campaignDispositionMix>;
}) {
  return (
    <>
      <div className="max-w-4xl mb-6">
        <InlineCardForm
          title="Description"
          endpoint={`/api/campaigns/${c.id}`}
          layout="rows"
          fields={[
            {
              type: 'textarea',
              name: 'description',
              label: 'Description',
              value: c.description,
              maxLength: 500,
              placeholder:
                'Optional — what this campaign dials, who it serves, etc.',
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
                : 'none — attach in List Mix'}
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

        {/* Iter 86 — Basic Pacing card is now ViciDial-style minimal:
            just dial_mode + dial_level. Advanced fields
            (base_ratio + max_abandon_pct) live on the Detail tab
            so the day-one operator sees only the two knobs that
            actually matter.
         */}
        <InlineCardForm
          title="Pacing"
          endpoint={`/api/campaigns/${c.id}`}
          layout="rows"
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
              hint: 'simulated = writes a dial-intent row but never goes to FS. live = real bgapi originate via the route plan.',
            },
            {
              type: 'number',
              name: 'dial_level',
              label: 'Dial level',
              value: c.dial_level,
              min: 0.1,
              max: 10,
              step: 0.1,
              hint: 'ViciDial-style multiplier. Per tick the pacer fires floor((local_agents + remote_lines) × dial_level) calls. 1.0 = power dial 1:1. 2.0 = fire 2× the pool so calls keep flowing even with carrier rejects / no-answers.',
            },
          ]}
          helpText="Live edits hot-reload into the pacer on the next tick. Advanced fields (base_ratio, max_abandon_%) are on the Detail tab."
        />

        <div>
          <InlineCardForm
            title="Hopper"
            endpoint={`/api/campaigns/${c.id}`}
            layout="rows"
            fields={[
              {
                type: 'number',
                name: 'hopper_level',
                label: 'Target depth',
                value: c.hopper_level,
                min: 1,
                max: 10000,
                step: 1,
                hint: 'Number of leads to keep pre-loaded into the campaign hopper. The pacer pops one per call and refills when depth drops below half target.',
              },
              {
                type: 'select',
                name: 'list_order',
                label: 'List order',
                value: c.list_order,
                options: [
                  {
                    value: 'RANDOM',
                    label: 'RANDOM — pick at random each refill (default)',
                  },
                  {
                    value: 'UP_TIME',
                    label:
                      'UP_TIME — oldest created leads first (clear backlog)',
                  },
                  {
                    value: 'DOWN_TIME',
                    label:
                      'DOWN_TIME — newest created leads first (work fresh imports)',
                  },
                  {
                    value: 'TZ_RANDOM',
                    label:
                      'TZ_RANDOM — random, only leads whose TZ is dialable now',
                  },
                  {
                    value: 'TZ_UP_TIME',
                    label:
                      'TZ_UP_TIME — oldest first, only TZ-dialable now',
                  },
                  {
                    value: 'TZ_DOWN_TIME',
                    label:
                      'TZ_DOWN_TIME — newest first, only TZ-dialable now',
                  },
                ],
                hint: 'How the hopper picks leads from this campaign’s lists during refill. Callback-due leads always take priority regardless of strategy. TZ_* variants filter to leads whose local hour is inside the campaign call window (or business hours 08:00–21:00 if no window set).',
              },
            ]}
            helpText={`Currently holding ${hopperDepth.toLocaleString()} of ${c.hopper_level.toLocaleString()} leads. Refills automatically when depth drops below half target.`}
          />
          <HopperResetButton campaignId={c.id} currentDepth={hopperDepth} />
        </div>
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
        {/* Iter 88 — bridge / detect modes will silently fail when
            the remote agent's SIP user isn't actually registered
            with FS. Surface that so the operator doesn't waste
            hours wondering why answered calls drop instead of
            ringing through to an agent. Polled live via
            sofia_contact on every page render.
         */}
        {(c.amd_action === 'bridge' || c.amd_action === 'detect') &&
          unregisteredRemotes.length > 0 && (
            <p className="bg-error/10 text-error border border-error/50 rounded mt-3 px-3 py-2 text-xs">
              On-answer mode is{' '}
              <span className="font-mono">{c.amd_action}</span> but the
              following remote agent target
              {unregisteredRemotes.length === 1 ? '' : 's'} {' '}
              {unregisteredRemotes.length === 1 ? 'is' : 'are'} NOT
              registered with FreeSWITCH:
              <ul className="mt-1 ml-4 list-disc">
                {unregisteredRemotes.map((r) => (
                  <li key={r.sip_uri}>
                    <span className="font-mono">{r.name}</span>{' '}
                    <span className="text-fg-muted">
                      ({r.sip_uri})
                    </span>
                  </li>
                ))}
              </ul>
              When a call answers, FS will execute{' '}
              <span className="font-mono">&amp;bridge(…)</span>,
              FS will respond <span className="font-mono">USER_NOT_REGISTERED</span>,
              and the call hangs up — leads answer, hear silence, and
              drop. Fix by signing a softphone/hardphone into that
              extension, OR by repointing the remote agent at{' '}
              <Link
                href="/remote-agents"
                className="underline hover:text-fg"
              >
                Remote Agents
              </Link>{' '}
              to a registered endpoint.
            </p>
          )}
        {/* Iter 82 — three distinct cases for active campaigns:
              A) truly nothing attached → red warn
              B) capacity exists & free → green math card
              C) capacity exists but saturated (in-flight ≥ lines) →
                 amber "throttled" card so the operator doesn't
                 misread "no agent" when a remote agent IS attached
                 but currently full.
         */}
        {c.status === 'active' &&
          activeAgents.length === 0 &&
          remoteLinesTotal === 0 && (
            <p className="bg-warn/10 text-warn border border-warn/50 rounded mt-3 px-3 py-2 text-xs">
              No active agents attached — pacer is running but cannot dial.
              Attach an active agent below or assign a remote agent to start
              delivering calls.
            </p>
          )}
        {/* Iter 89 — pacing math is remote-lines × dial_level (when
            any remote agents are attached). Local agents are bridge
            targets, NOT pool inflaters. Remote agents are pure
            ratio-dial seats — they never receive bridges.
         */}
        {c.status === 'active' && remoteLinesTotal > 0 && (
          <p className="bg-card-hover/40 text-fg-muted border border-border rounded mt-3 px-3 py-2 text-xs">
            {remoteInFlight} / {remoteLinesTotal} remote line
            {remoteLinesTotal === 1 ? '' : 's'} in flight. Total
            in-flight cap:{' '}
            <span className="font-mono">
              floor({remoteLinesTotal} × {c.dial_level}) ={' '}
              {Math.max(
                1,
                Math.floor(remoteLinesTotal * (c.dial_level || 1)),
              )}
            </span>{' '}
            call
            {Math.max(
              1,
              Math.floor(remoteLinesTotal * (c.dial_level || 1)),
            ) === 1
              ? ''
              : 's'}{' '}
            outstanding at a time (iter 108 — was previously per-tick
            with no decrement, which over-dialed). Remote agents
            only count toward the ratio — bridges land on local
            agents{' '}
            {activeAgents.length > 0
              ? `(${activeAgents.length} signed in right now)`
              : '(none signed in right now)'}
            .
          </p>
        )}
        {/* Iter 89 — when amd_action=bridge but ONLY remote agents
            exist (no local), every answered call abandons because
            there's no local target to bridge to. Surface that
            loudly. */}
        {c.status === 'active' &&
          (c.amd_action === 'bridge' || c.amd_action === 'detect') &&
          activeAgents.length === 0 &&
          remoteLinesTotal > 0 && (
            <p className="bg-warn/10 text-warn border border-warn/50 rounded mt-3 px-3 py-2 text-xs">
              On-answer mode is{' '}
              <span className="font-mono">{c.amd_action}</span> but
              no local agent is signed in for this campaign. Every
              answered call will instantly hang up (= abandoned)
              because remote agents are ratio-dial seats only — they
              don&apos;t accept bridges. Sign an agent into{' '}
              <Link href="/agent" className="underline hover:text-fg">
                /agent
              </Link>{' '}
              for a user attached to this campaign, or switch
              On-answer to{' '}
              <span className="font-mono">voicemail</span> /{' '}
              <span className="font-mono">drop</span> on the Detail
              tab.
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

      <DispositionMixCard rows={dispoMix} />
    </>
  );
}

// Iter 99 — disposition mix card for the campaign basic tab.
// Renders the 7 ViciDial-style outcomes + an OPEN bucket
// (connected calls awaiting a disposition) as a horizontal
// strip. Zero-count cells are dimmed so the operator scans
// active outcomes at a glance.
const DISPOSITION_TONES: Record<string, { dot: string; text: string }> = {
  SALE: { dot: 'bg-success', text: 'text-success' },
  CALLBACK: { dot: 'bg-info', text: 'text-info' },
  SURVEYED: { dot: 'bg-success', text: 'text-success' },
  VOICEMAIL_DROPPED: { dot: 'bg-info', text: 'text-info' },
  NO_INTEREST: { dot: 'bg-fg-muted', text: 'text-fg-muted' },
  ANSWERING_MACHINE: { dot: 'bg-fg-muted', text: 'text-fg-muted' },
  WRONG_NUMBER: { dot: 'bg-warn', text: 'text-warn' },
  BAD_NUMBER: { dot: 'bg-error', text: 'text-error' },
  DNC: { dot: 'bg-error', text: 'text-error' },
  OPEN: { dot: 'bg-accent', text: 'text-accent' },
};
function DispositionMixCard({
  rows,
}: {
  rows: ReturnType<typeof campaignDispositionMix>;
}) {
  const total = rows.reduce(
    (a, r) => (r.disposition === 'OPEN' ? a : a + r.count),
    0,
  );
  const open = rows.find((r) => r.disposition === 'OPEN')?.count ?? 0;
  return (
    <div className="border border-border rounded p-4 mb-6 max-w-5xl">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted">
          Dispositions today
        </h2>
        <span className="text-xs text-fg-subtle tabular-nums">
          {total.toLocaleString()} logged
          {open > 0 && (
            <>
              {' · '}
              <span className="text-accent">{open} open</span>
            </>
          )}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {rows.map((r) => {
          const tone = DISPOSITION_TONES[r.disposition] ?? {
            dot: 'bg-fg-muted',
            text: 'text-fg-muted',
          };
          const dim = r.count === 0;
          return (
            <div
              key={r.disposition}
              className={`border border-border rounded px-2 py-1.5 ${
                dim ? 'opacity-50' : ''
              }`}
              title={
                r.disposition === 'OPEN'
                  ? 'Calls connected today that the agent has not yet dispositioned'
                  : r.disposition
              }
            >
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                <span className="text-[10px] uppercase tracking-wide text-fg-subtle truncate">
                  {r.disposition.replace(/_/g, ' ')}
                </span>
              </div>
              <div className={`text-lg mt-0.5 tabular-nums ${tone.text}`}>
                {r.count.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-fg-subtle mt-3">
        Reset at UTC midnight. OPEN = connected calls with no agent
        outcome yet (wrap-up backlog).
      </p>
    </div>
  );
}

function DetailTab({
  c,
  activeAgents,
  dialableStatuses,
}: {
  c: ReturnType<typeof getCampaign> & {};
  activeAgents: ReturnType<typeof getActiveAgentsForCampaign>;
  dialableStatuses: string[];
}) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mb-6">
        {/* Iter 86 — Advanced pacing knobs moved off the Basic tab so
            that page has just the two dials operators touch daily
            (dial_mode + dial_level). These are still editable and
            live-reload the pacer, just out of the way.
         */}
        <InlineCardForm
          title="Advanced pacing"
          endpoint={`/api/campaigns/${c.id}`}
          layout="rows"
          fields={[
            {
              type: 'number',
              name: 'base_ratio',
              label: 'Base ratio',
              value: c.base_ratio,
              min: 0.5,
              max: 10,
              step: 0.1,
              hint: 'Legacy. Calls placed per available agent. Most setups should use Dial level (Basic tab) instead.',
            },
            {
              type: 'number',
              name: 'max_abandon_pct',
              label: 'Max abandon %',
              value: c.max_abandon_pct,
              min: 0,
              max: 100,
              step: 0.1,
              hint: 'Maximum % of calls allowed to drop because no agent was free. US TCPA compliance is typically ≤3%.',
            },
            {
              type: 'checkboxes',
              name: 'dialable_statuses',
              label: 'Dialable statuses',
              value: dialableStatuses,
              options: [
                { value: 'NEW', label: 'NEW (fresh leads, never called)' },
                {
                  value: 'CALLED_NO_ANSWER',
                  label: 'CALLED_NO_ANSWER (retry no-answers)',
                },
                { value: 'BUSY', label: 'BUSY (retry busy signals)' },
                {
                  value: 'CALLBACK_SCHEDULED',
                  label:
                    'CALLBACK_SCHEDULED (kept on for safety — Pass 1 always handles these)',
                },
                {
                  value: 'VM_PLAYED',
                  label:
                    'VM_PLAYED (re-engage prospects who heard our voicemail)',
                },
                {
                  value: 'SURVEYED',
                  label: 'SURVEYED (follow-up on completed surveys)',
                },
                {
                  value: 'BAD_NUMBER',
                  label: 'BAD_NUMBER (re-validation sweeps)',
                },
                {
                  value: 'CONVERTED',
                  label: 'CONVERTED (re-engage already-closed leads)',
                },
                {
                  value: 'DNC_TEMP',
                  label: 'DNC_TEMP (temporary block expired)',
                },
              ],
              hint: 'Pacer only dials leads in these statuses. Default NEW + CALLED_NO_ANSWER + BUSY matches ViciDial behaviour. Adding BAD_NUMBER turns this into a re-validation sweep; removing CALLED_NO_ANSWER means missed calls won’t be retried.',
            },
          ]}
          helpText="Day-to-day dialing rarely needs base_ratio / abandon%. Dialable statuses is your retry policy — tighten when you want only fresh leads."
        />

        <InlineCardForm
          title="On answer behaviour"
          endpoint={`/api/campaigns/${c.id}`}
          layout="rows"
          fields={[
            {
              type: 'select',
              name: 'amd_action',
              label: 'When the lead answers',
              value: c.amd_action,
              options: [
                {
                  value: 'bridge',
                  label: 'bridge — connect the lead to an agent (default)',
                },
                {
                  value: 'detect',
                  label:
                    'detect — AMD: bridge if human, voicemail/drop if machine',
                },
                {
                  value: 'voicemail',
                  label:
                    'voicemail — play the uploaded .wav and hang up (voice-blast)',
                },
                {
                  value: 'drop',
                  label: 'drop — hang up at answer (connectivity probing only)',
                },
              ],
              hint: 'Detect mode runs amd_v2 at answer; humans bridge to an agent, machines play the voicemail file (if uploaded) and hang up. Voice-blast = always playback. Drop = always hang up.',
            },
          ]}
          helpText="Upload the voicemail .wav in the next card if you pick detect or voicemail."
        />

        <VoicemailPanel
          campaignId={c.id}
          amdAction={c.amd_action}
          voicemailPath={c.voicemail_path}
        />

        <InlineCardForm
          title="Compliance"
          endpoint={`/api/campaigns/${c.id}`}
          layout="rows"
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
    </>
  );
}

function ListMixTab({
  c,
  leadListIds,
  allLeadLists,
  inGroupIds,
  allInGroups,
}: {
  c: ReturnType<typeof getCampaign> & {};
  leadListIds: string[];
  allLeadLists: ReturnType<typeof listLeadLists>;
  inGroupIds: string[];
  allInGroups: ReturnType<typeof listInGroups>;
}) {
  return (
    <>
      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Lead lists attached ({leadListIds.length})
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
          In-groups attached ({inGroupIds.length})
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
    </>
  );
}

function RealtimeTab({
  c,
  activeAgents,
  remoteCapacity,
  remoteLinesTotal,
  remoteInFlight,
}: {
  c: ReturnType<typeof getCampaign> & {};
  activeAgents: number;
  remoteCapacity: number;
  remoteLinesTotal: number;
  remoteInFlight: number;
}) {
  // Iter 89 — pacing pool = remote lines only (when any remote
  // agents attached). Local agents are bridge targets, not ratio
  // seats. Matches the change in pacing.ts. Fallback to local
  // count for pure-local campaigns.
  const poolSize =
    remoteLinesTotal > 0 ? remoteLinesTotal : activeAgents;
  const target =
    poolSize > 0
      ? Math.max(1, Math.floor(poolSize * (c.dial_level || 1)))
      : 0;
  return (
    <>
      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Dial intents (live)
        </h2>
        <PacingPanel
          campaignId={c.id}
          isActive={c.status === 'active'}
          initialTotal={totalIntentsFor(c.id)}
        />
        <p className="text-xs text-fg-subtle mt-3">
          Ratio pool: {remoteLinesTotal} remote line
          {remoteLinesTotal === 1 ? '' : 's'} ({remoteInFlight} in
          flight · {remoteCapacity} idle). Bridge targets:{' '}
          {activeAgents} local agent
          {activeAgents === 1 ? '' : 's'} signed in (remote agents
          are seats only, never receive bridges). Per-tick target:{' '}
          <span className="font-mono">
            floor({poolSize} × {c.dial_level}) = {target}
          </span>{' '}
          call{target === 1 ? '' : 's'}. For carrier-level and
          floor-wide live boards, see{' '}
          <Link href="/realtime" className="underline hover:text-fg">
            /realtime
          </Link>
          .
        </p>
        {/* Iter 126 — CSV export of this campaign's call history.
            Lifetime by default; the endpoint accepts ?since=ISO
            for a date-bounded slice (no UI for it yet — power
            users can craft the URL directly). */}
        <div className="mt-3 flex items-center gap-3">
          <a
            href={`/api/campaigns/${c.id}/call-history-export`}
            className="text-xs px-3 py-1 rounded border border-border text-fg-muted hover:text-fg hover:bg-card-hover/40"
          >
            Export call history (CSV)
          </a>
          <a
            href={`/api/campaigns/${c.id}/call-history-export?since=${new Date(Date.now() - 24 * 3600_000).toISOString()}`}
            className="text-xs px-3 py-1 rounded border border-border text-fg-muted hover:text-fg hover:bg-card-hover/40"
          >
            Last 24h only
          </a>
        </div>
      </div>

      {/* Iter 122 — AMD breakdown is only meaningful when the
          campaign actually runs amd_v2 (amd_action='detect'). Hide
          the card otherwise; surfaces a stable 5-bucket strip when
          enabled. */}
      <AnswerRateCard
        campaignId={c.id}
        currentDialLevel={c.dial_level}
      />
      {c.amd_action === 'detect' && (
        <AmdBreakdownCard rows={amdBreakdownForCampaignToday(c.id)} />
      )}
    </>
  );
}

// Iter 122 — AMD result card. Renders the 4 known amd_v2 codes
// (HUMAN / MACHINE / NOTSURE / UNKNOWN) + a synthetic NO_AMD
// bucket counting answered calls that didn't run AMD — useful
// for spotting a misconfigured amd_action mid-shift.
const AMD_TONES: Record<string, { dot: string; text: string }> = {
  HUMAN: { dot: 'bg-success', text: 'text-success' },
  MACHINE: { dot: 'bg-info', text: 'text-info' },
  NOTSURE: { dot: 'bg-warn', text: 'text-warn' },
  UNKNOWN: { dot: 'bg-fg-muted', text: 'text-fg-muted' },
  NO_AMD: { dot: 'bg-error', text: 'text-error' },
};
function AmdBreakdownCard({
  rows,
}: {
  rows: ReturnType<typeof amdBreakdownForCampaignToday>;
}) {
  const total = rows.reduce(
    (a, r) => (r.amd_result === 'NO_AMD' ? a : a + r.count),
    0,
  );
  const noAmd = rows.find((r) => r.amd_result === 'NO_AMD')?.count ?? 0;
  return (
    <div className="border border-border rounded p-4 mb-6 max-w-4xl">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted">
          AMD detection today
        </h2>
        <span className="text-xs text-fg-subtle tabular-nums">
          {total.toLocaleString()} classified
          {noAmd > 0 && (
            <>
              {' · '}
              <span className="text-error">{noAmd} no-AMD</span>
            </>
          )}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {rows.map((r) => {
          const tone = AMD_TONES[r.amd_result] ?? {
            dot: 'bg-fg-muted',
            text: 'text-fg-muted',
          };
          const dim = r.count === 0;
          return (
            <div
              key={r.amd_result}
              className={`border border-border rounded px-2 py-1.5 ${
                dim ? 'opacity-50' : ''
              }`}
              title={
                r.amd_result === 'NO_AMD'
                  ? 'Answered calls today that did NOT run AMD — campaign config drift?'
                  : r.amd_result
              }
            >
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                <span className="text-[10px] uppercase tracking-wide text-fg-subtle truncate">
                  {r.amd_result.replace(/_/g, ' ')}
                </span>
              </div>
              <div className={`text-lg mt-0.5 tabular-nums ${tone.text}`}>
                {r.count.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-fg-subtle mt-3">
        amd_v2 classifies the destination at answer time. NOTSURE /
        UNKNOWN are treated as HUMAN by the dialeros-amd dispatch
        extension so we never drop a real caller. NO_AMD &gt; 0 means
        some answered calls bypassed AMD — check the dialplan or the
        amd_action setting.
      </p>
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
