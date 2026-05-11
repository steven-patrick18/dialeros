import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import {
  applyDialIntentOriginate,
  closeSimulatedDialIntent,
  countDialIntentsForCampaign,
  getAvailableAgentsForCampaign,
  getCampaignFromDb,
  getCarrierFromDb,
  getCidGroupFromDb,
  getNodeFromDb,
  getPhoneByExtension,
  getPrimaryPhoneForUser,
  getRoutePlanFromDb,
  hopperSize,
  inFlightForCarrier,
  insertDialIntent,
  listCampaignsFromDb,
  listCarriersForRoutePlanFromDb,
  listCidsInGroupFromDb,
  listDialIntentsForCampaign,
  markLeadDialed,
  parseNodeRoles,
  popHopperLead,
  reapStaleDialIntents,
  refillHopper,
  type CampaignRecord,
  type CarrierRecord,
  type DialIntentRecord,
  type RemoteAgentRecord,
} from './db';
import { parseCidGroupIds, parseCidPool } from './route-plan';
import {
  applyDialPlanRule,
  carrierAcceptsDestination,
  findMatchingDialPlanRule,
} from './carrier';
import { isDnc } from './dnc';
import { ensureFsEventListener } from './fs-events';
import {
  backfillUserPhones,
  ensureLocalNodeRegistered,
} from './local-node';
import { ensureRecordingRetentionSweep } from './recording-retention';
import { listRemoteAgentsWithCapacity } from './remote-agent';
import { extensionForUser } from './sip-extensions';
import { hourInTimezone, inferLeadTimezone } from './timezones';

// Iter 11 — pacing engine v1 (simulation).
//
// Each "active" campaign gets an in-process timer that periodically:
//   1. Picks the next dialable lead from the campaign's attached lists.
//   2. Applies the route plan's number transform + CID strategy.
//   3. Records a dial_intent row + emits a live event.
//   4. Marks the lead status = CALLED_NO_ANSWER (simulating an unanswered
//      ringout). Cooldown means it will be picked up again later in the loop.
//
// When telephony lands, step 3 also originates a real call via FreeSWITCH ESL.
// For now it's purely a simulation and never actually rings a phone.
//
// Pacing cadence: fixed 3 seconds for demo. Real pacing math (per-agent ratio,
// abandoned-rate clamping) lands in iter 12+ when there are agent slots to
// pace against.

const DEMO_INTERVAL_MS = 3000;
const COOLDOWN_SECONDS = 60;

type PacerHandle = NodeJS.Timeout;

interface BusContainer {
  bus: EventEmitter;
  pacers: Map<string, PacerHandle>;
  rotateState: Map<string, number>; // campaign_id -> rotate cursor for cid_pool
  agentRotateState: Map<string, number>; // campaign_id -> agent round-robin cursor
  // Iter 45 — rotation cursor per (carrier_id, dialplan_rule_index).
  // Spreads traffic across a rule's replacement list round-robin so
  // 0805 → [310,311,312] alternates evenly across calls.
  dialPlanRotateState: Map<string, number>;
  // Iter 58 — campaign_id -> cursor over the combined local+remote
  // bridge pool. Recomputed each tick from live capacity.
  bridgeRotateState: Map<string, number>;
  // Iter 72 — when route plan has cid_strategy='groups', we rotate
  // across the attached groups per call: key = route_plan_id, value
  // = cursor into cid_group_ids array.
  cidGroupPlanCursor: Map<string, number>;
  // Iter 72 — within a chosen group with strategy='rotate' or
  // 'sticky_by_area' (fallback), we rotate across the numbers:
  // key = group_id, value = cursor.
  cidGroupNumberCursor: Map<string, number>;
  // Iter 74 — round-robin cursor for (route_plan_id, priority) so
  // equal-priority carriers split traffic evenly (1,1 = 50/50).
  carrierTierCursor: Map<string, number>;
}

declare global {
  // eslint-disable-next-line no-var
  var __dialeros_pacing: BusContainer | undefined;
}

function container(): BusContainer {
  if (!globalThis.__dialeros_pacing) {
    const e = new EventEmitter();
    e.setMaxListeners(0);
    globalThis.__dialeros_pacing = {
      bus: e,
      pacers: new Map(),
      rotateState: new Map(),
      agentRotateState: new Map(),
      dialPlanRotateState: new Map(),
      bridgeRotateState: new Map(),
      cidGroupPlanCursor: new Map(),
      cidGroupNumberCursor: new Map(),
      carrierTierCursor: new Map(),
    };
  }
  // Older sessions might predate the newer state maps — patch
  // defensively so HMR-cached containers don't crash on access.
  const c = globalThis.__dialeros_pacing!;
  if (!c.agentRotateState) c.agentRotateState = new Map();
  if (!c.dialPlanRotateState) c.dialPlanRotateState = new Map();
  if (!c.bridgeRotateState) c.bridgeRotateState = new Map();
  if (!c.cidGroupPlanCursor) c.cidGroupPlanCursor = new Map();
  if (!c.cidGroupNumberCursor) c.cidGroupNumberCursor = new Map();
  if (!c.carrierTierCursor) c.carrierTierCursor = new Map();
  return c;
}

/**
 * Iter 45 — bump-and-return the rotation cursor for a (carrier, rule)
 * pair. Caller passes the value to applyDialPlanRules, which mods it
 * against the replacement list length.
 */
function nextDialPlanCursor(carrierId: string, ruleIndex: number): number {
  const c = container();
  const key = `${carrierId}:${ruleIndex}`;
  const cur = c.dialPlanRotateState.get(key) ?? 0;
  c.dialPlanRotateState.set(key, cur + 1);
  return cur;
}

/** Exported for the manual-dial / test-call paths so they share the
 * same rotation cursor as the pacer. */
export function rotateDialPlanCursor(
  carrierId: string,
  ruleIndex: number,
): number {
  return nextDialPlanCursor(carrierId, ruleIndex);
}

function applyTransform(
  phone: string,
  strip: string | null,
  add: string | null,
): string {
  let result = phone;
  if (strip && result.startsWith(strip)) {
    result = result.slice(strip.length);
  }
  if (add) {
    result = add + result;
  }
  return result;
}

/** Iter 74 — pick a carrier for this route plan to dial through.
 * Walks the priority tiers in ascending order; within a tier filters
 * to (enabled + accepts destination + below port cap) and round-robins.
 * Falls through to the next tier when nothing in this one is usable.
 * Returns null when every tier is exhausted. */
function pickCarrierForPlan(
  planId: string,
  destination: string,
): CarrierRecord | null {
  const rows = listCarriersForRoutePlanFromDb(planId);
  if (rows.length === 0) return null;

  // Group rows by priority tier.
  const byPriority = new Map<number, typeof rows>();
  for (const r of rows) {
    const list = byPriority.get(r.priority) ?? [];
    list.push(r);
    byPriority.set(r.priority, list);
  }
  const priorities = [...byPriority.keys()].sort((a, b) => a - b);

  const c = container();
  for (const p of priorities) {
    const tier = byPriority.get(p)!;
    // Resolve each row to its carrier + apply the gates.
    const candidates: Array<{ carrier: CarrierRecord; ports: number }> = [];
    for (const row of tier) {
      const carrier = getCarrierFromDb(row.carrier_id);
      if (!carrier) continue;
      if (carrier.enabled !== 1) continue;
      if (!carrierAcceptsDestination(carrier, destination)) continue;
      if (inFlightForCarrier(carrier.id) >= row.ports) continue;
      candidates.push({ carrier, ports: row.ports });
    }
    if (candidates.length === 0) continue;
    const cursorKey = `${planId}:${p}`;
    const cur = c.carrierTierCursor.get(cursorKey) ?? 0;
    const picked = candidates[cur % candidates.length]!;
    c.carrierTierCursor.set(cursorKey, cur + 1);
    return picked.carrier;
  }
  return null;
}

function pickCid(
  campaign_id: string,
  strategy: string,
  single: string | null,
  pool: string[],
  groupIds: string[],
  routePlanId: string,
  destination: string,
): string | null {
  if (strategy === 'single') return single;
  if (strategy === 'rotate' && pool.length > 0) {
    const c = container();
    const cursor = c.rotateState.get(campaign_id) ?? 0;
    const cid = pool[cursor % pool.length] ?? null;
    c.rotateState.set(campaign_id, cursor + 1);
    return cid;
  }
  if (strategy === 'groups' && groupIds.length > 0) {
    return pickCidFromGroups(routePlanId, groupIds, destination);
  }
  return null; // passthrough — campaign / lead-level CID logic added later
}

/** Iter 72 — pick a CID by:
 *   1. Rotate across the plan's attached groups (one per call).
 *   2. Apply the chosen group's own strategy:
 *        rotate          — round-robin numbers
 *        random          — uniform random
 *        sticky_by_area  — first prefix match against `destination`,
 *                          else fall back to rotate.
 * Returns null when no usable number is found (empty groups). */
function pickCidFromGroups(
  routePlanId: string,
  groupIds: string[],
  destination: string,
): string | null {
  const c = container();
  // Rotate to the next group with at least one number. Bounded retry so
  // we don't infinite-loop if every attached group is empty.
  let cursor = c.cidGroupPlanCursor.get(routePlanId) ?? 0;
  for (let attempt = 0; attempt < groupIds.length; attempt++) {
    const gid = groupIds[(cursor + attempt) % groupIds.length]!;
    const group = getCidGroupFromDb(gid);
    if (!group) continue;
    const numbers = listCidsInGroupFromDb(gid).map((n) => n.number);
    if (numbers.length === 0) continue;

    c.cidGroupPlanCursor.set(routePlanId, cursor + attempt + 1);

    if (group.strategy === 'random') {
      return numbers[Math.floor(Math.random() * numbers.length)]!;
    }
    if (group.strategy === 'sticky_by_area') {
      const m = matchByAreaCode(numbers, destination);
      if (m) return m;
      // Fall through to rotate.
    }
    // rotate (default) — bump per-group cursor.
    const numCursor = c.cidGroupNumberCursor.get(gid) ?? 0;
    const cid = numbers[numCursor % numbers.length]!;
    c.cidGroupNumberCursor.set(gid, numCursor + 1);
    return cid;
  }
  // Every attached group was empty / missing.
  c.cidGroupPlanCursor.set(routePlanId, cursor + 1);
  return null;
}

/** Pick the number whose digits share the longest leading-digit prefix
 * with `destination`. Falls back to area-code (first 3-5 digits) match.
 * Returns null when nothing usefully matches. Strips leading + / 1 so
 * "+14155551234" and "4155551234" compare equally. */
function matchByAreaCode(
  numbers: string[],
  destination: string,
): string | null {
  const dest = destination.replace(/^\+?1?/, '');
  if (dest.length < 3) return null;
  const destArea = dest.slice(0, 3);
  for (const n of numbers) {
    const cleaned = n.replace(/^\+?1?/, '');
    if (cleaned.slice(0, 3) === destArea) return n;
  }
  return null;
}

export interface PacingTickResult {
  outcome:
    | 'dialed'
    | 'no_route_plan'
    | 'no_lead'
    | 'no_agents'
    | 'no_carrier'
    | 'no_matching_prefix'
    | 'outside_window'
    | 'outside_lead_tz_window'
    | 'dnc'
    | 'inbound_no_pacer'
    | 'campaign_missing'
    | 'campaign_inactive';
  intent?: DialIntentRecord;
  assigned_agent?: { id: string; username: string };
  /** Iter 32 — when dial_mode='live'. Job UUID on success, error on failure. */
  originate?:
    | { ok: true; job_uuid: string }
    | { ok: false; error: string };
}

/**
 * Iter 20 — call-window enforcement. Returns true if the campaign has
 * no window restriction, or if the dialer's current local time-of-day
 * falls inside [start, end].
 *
 * `caller-local` in the spec — but we don't have per-lead timezones yet,
 * so we treat the configured window as dialer-local. Acceptable for a
 * single-region deployment; revisit when leads carry timezone metadata
 * (likely derived from area code).
 *
 * Wraps midnight: if start > end (e.g. 22:00–06:00) the window includes
 * everything outside [end, start].
 */
export function isCampaignWithinCallWindow(
  campaign: CampaignRecord,
  now = new Date(),
): boolean {
  return isWithinCallWindow(campaign, now);
}

function isWithinCallWindow(campaign: CampaignRecord, now = new Date()): boolean {
  const start = campaign.call_window_start;
  const end = campaign.call_window_end;
  if (!start || !end) return true; // no restriction

  const minutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(':').map(Number) as [number, number];
  const [eh, em] = end.split(':').map(Number) as [number, number];
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin === endMin) return false; // empty window — never dial
  if (startMin < endMin) {
    return minutes >= startMin && minutes < endMin;
  }
  // wraps midnight
  return minutes >= startMin || minutes < endMin;
}

export const __test__ = { isWithinCallWindow };

function pickAgent(
  campaignId: string,
  agents: Array<{ id: string; username: string }>,
): { id: string; username: string } | null {
  if (agents.length === 0) return null;
  const c = container();
  const cursor = c.agentRotateState.get(campaignId) ?? 0;
  const agent = agents[cursor % agents.length]!;
  c.agentRotateState.set(campaignId, cursor + 1);
  return agent;
}

// Iter 58 — bridge target = where the originated leg gets sent on
// answer. Combined pool of (a) local available agents + (b) every
// "line slot" of every enabled remote agent that isn't already at
// capacity. Round-robin via a per-campaign cursor so traffic spreads
// across all of them rather than pinning to one.
type BridgeTarget =
  | { kind: 'local'; agent: { id: string; username: string } }
  | { kind: 'remote'; agent: RemoteAgentRecord };

function buildBridgePool(
  localAgents: Array<{ id: string; username: string }>,
  _remote: Array<{ agent: RemoteAgentRecord; available: number }>,
): BridgeTarget[] {
  // Iter 89 — bridge targets are LOCAL ONLY. Remote agents now
  // exist solely for ratio-dial math; they never receive a bridge.
  // Calls bridge to a real human agent registered on the box. If
  // no local agent is signed in, the originate still goes out (the
  // remote-agent count drives the pacing math), the call answers,
  // and the bridge fails with NO_USER — that's the abandoned-call
  // case ViciDial's max_abandon_% covers.
  const pool: BridgeTarget[] = [];
  for (const a of localAgents) pool.push({ kind: 'local', agent: a });
  return pool;
}

function pickBridgeTarget(
  campaignId: string,
  pool: BridgeTarget[],
): BridgeTarget | null {
  if (pool.length === 0) return null;
  const c = container();
  const cursor = c.bridgeRotateState.get(campaignId) ?? 0;
  const target = pool[cursor % pool.length]!;
  c.bridgeRotateState.set(campaignId, cursor + 1);
  return target;
}

/** Iter 89 — round-robin a remote agent's id onto each outgoing
 * originate so port-cap math (inFlightForRemoteAgent) and
 * downstream reports stay accurate. Pacer no longer bridges TO the
 * remote, but the originate is "carried" by one of the remote
 * agent's logical lines — that's where the ratio-dial seat count
 * comes from. */
function pickRemoteAgentForAttribution(
  campaignId: string,
  remoteSlots: Array<{ agent: RemoteAgentRecord; available: number }>,
): RemoteAgentRecord | null {
  if (remoteSlots.length === 0) return null;
  const c = container();
  // Reuse the bridge rotate cursor — it's already campaign-scoped
  // and was previously walking the same set.
  const cursor = c.bridgeRotateState.get(`${campaignId}:remote`) ?? 0;
  const pick = remoteSlots[cursor % remoteSlots.length]!;
  c.bridgeRotateState.set(`${campaignId}:remote`, cursor + 1);
  return pick.agent;
}

/**
 * Run a single pacing tick for a campaign. Exported for tests + manual
 * "Dial next" buttons.
 *
 * Iter 16 — agent-aware. The pacer only fires if at least one active
 * agent is attached to the campaign.
 *
 * Iter 32 — dial-mode aware. When campaign.dial_mode='simulated' (default,
 * no-cost), behavior is unchanged: insert a dial-intent row and mark the
 * lead. When dial_mode='live', the pacer ALSO sends a bgapi originate to
 * FreeSWITCH via the route plan's primary-carrier gateway. The job UUID
 * (or error) is captured on the dial_intent row. The originate is
 * non-blocking — bgapi returns immediately with the job UUID, so a slow
 * carrier handshake doesn't pile up pacer ticks.
 */
export async function paceCampaignOnce(
  campaignId: string,
): Promise<PacingTickResult> {
  const campaign = getCampaignFromDb(campaignId);
  if (!campaign) return { outcome: 'campaign_missing' };
  if (campaign.status !== 'active') return { outcome: 'campaign_inactive' };
  // Iter 21 — inbound_queue waits for calls; nothing to pace.
  if (campaign.type === 'inbound_queue') {
    return { outcome: 'inbound_no_pacer' };
  }
  if (!isWithinCallWindow(campaign)) return { outcome: 'outside_window' };

  const plan = getRoutePlanFromDb(campaign.route_plan_id);
  if (!plan) return { outcome: 'no_route_plan' };

  // Iter 40 — paused agents are filtered out so the pacer doesn't
  // bridge live calls to someone who's stepped away.
  // Iter 73 — fix: bail only when BOTH local and remote pools are
  // empty. Previously this returned no_agents whenever there were 0
  // logged-in browser agents, which meant a campaign staffed purely
  // by a remote SIP endpoint (e.g. an external hard-phone bank)
  // could never dial — even though listRemoteAgentsWithCapacity
  // reported free lines. Now the local check is paired with a
  // remote-line-capacity check; the actual bridge pool is built
  // below from both pools combined.
  const agents = getAvailableAgentsForCampaign(campaignId);
  const remoteSlots = listRemoteAgentsWithCapacity(campaignId);
  // Iter 86 — bail only when nothing is CONFIGURED (no local agents
  // logged in AND no remote-agent lines configured). Previously the
  // bail used `available` capacity, which meant over-dialed calls
  // (dial_level > 1) would short-circuit as soon as all current
  // lines were busy — defeating the point of dial_level > 1.
  // Over-dial is intentional: extras get abandoned in FS when the
  // bridge target is saturated, matching ViciDial behavior.
  const remoteLinesTotal = remoteSlots.reduce(
    (s, r) => s + r.agent.lines,
    0,
  );
  if (agents.length === 0 && remoteLinesTotal === 0) {
    return { outcome: 'no_agents' };
  }

  // Iter 49 — pop from the campaign hopper. If it's empty (or below
  // half-full), refill on demand and try again. The refill query is
  // INSERT-OR-IGNORE-driven so concurrent ticks won't double-add.
  let lead = popHopperLead(campaignId);
  if (!lead) {
    refillHopper(campaignId, campaign.hopper_level, COOLDOWN_SECONDS);
    lead = popHopperLead(campaignId);
  } else if (hopperSize(campaignId) < Math.floor(campaign.hopper_level / 2)) {
    refillHopper(campaignId, campaign.hopper_level, COOLDOWN_SECONDS);
  }
  if (!lead) return { outcome: 'no_lead' };

  // Iter 64 — DNC + per-lead TZ compliance. Check BEFORE the bridge
  // pool is consulted so we don't waste a slot on a call that can't
  // legally happen. Lead's local hour is inferred from its phone;
  // unknown TZs fall back to the dialer-local window already
  // enforced by isWithinCallWindow above.
  if (isDnc(lead.phone)) {
    markLeadDialed(lead.lead_id, 'DNC');
    return { outcome: 'dnc' };
  }
  if (campaign.call_window_start && campaign.call_window_end) {
    const tz = inferLeadTimezone(lead.phone);
    if (tz) {
      const h = hourInTimezone(tz);
      const [sh] = campaign.call_window_start.split(':').map(Number) as [
        number,
        number,
      ];
      const [eh] = campaign.call_window_end.split(':').map(Number) as [
        number,
        number,
      ];
      const inWindow =
        sh <= eh ? h >= sh && h < eh : h >= sh || h < eh;
      if (!inWindow) {
        // Skip this lead for now — it'll come back into the hopper
        // on the next refill cycle, by which time the TZ window
        // may have opened. CALLBACK_SCHEDULED would be wrong
        // (it's not callback-due), so we just bounce to
        // CALLED_NO_ANSWER which honours the cooldown.
        markLeadDialed(lead.lead_id, 'CALLED_NO_ANSWER');
        return { outcome: 'outside_lead_tz_window' };
      }
    }
  }

  // Iter 89 — bridge pool is LOCAL agents only. Remote agents drive
  // the ratio-dialing pool (above) but never receive bridges. If no
  // local agent is available at originate time AND amd_action needs
  // a bridge (bridge / detect HUMAN path), the call still goes out
  // — the originate is "abandoned" in ViciDial terms when it
  // answers with no agent to receive it. Concretely: bridgeApp gets
  // overridden to &hangup so the answered call drops cleanly.
  const bridgePool = buildBridgePool(agents, remoteSlots);
  const bridgeTarget = pickBridgeTarget(campaignId, bridgePool);
  if (bridgeTarget?.kind === 'local') pickAgent(campaignId, agents);
  const assigned: { id: string; username: string } | null =
    bridgeTarget?.kind === 'local' ? bridgeTarget.agent : null;
  // Iter 89 — remoteAgent is now only used for in-flight accounting
  // and dial_intents.remote_agent_id. We attribute the originate to
  // the rotated-through remote agent (so port-cap math + reports
  // stay correct), even though that remote agent itself never gets
  // bridged into the call.
  const remoteAgent: RemoteAgentRecord | null =
    remoteSlots.length > 0 ? pickRemoteAgentForAttribution(campaignId, remoteSlots) : null;

  const transformed = applyTransform(
    lead.phone,
    plan.transform_strip_prefix,
    plan.transform_add_prefix,
  );
  const cid = pickCid(
    campaignId,
    plan.cid_strategy,
    plan.cid_single,
    parseCidPool(plan),
    parseCidGroupIds(plan),
    plan.id,
    transformed,
  );

  // Iter 32 — when dial_mode='live', issue a real bgapi originate. We
  // do this BEFORE inserting the dial_intent so we can capture the job
  // UUID (or error) on the same row.
  // Iter 33 — pre-generate a correlation_id and pass it through the
  // originate as a channel variable. CHANNEL_HANGUP_COMPLETE etc.
  // events carry it back as variable_dialeros_correlation_id, letting
  // the FS event listener find this row.
  let originateOutcome: PacingTickResult['originate'];
  let kind = 'simulated';
  let correlationId: string | null = null;
  let recordingPath: string | null = null;
  // Iter 74 — the carrier actually picked by pickCarrierForPlan, so
  // the dial_intent row can be attributed for in-flight counts.
  let pickedCarrierId: string | null = null;
  // Iter 79 — pre-generate the correlation_id on the live path so we
  // can INSERT the dial_intent BEFORE calling bgapi. Without this, FS
  // rejects the call faster than the await resolves, the
  // CHANNEL_HANGUP_COMPLETE arrives at our listener while the row
  // doesn't exist yet, the UPDATE matches 0, and the hangup info is
  // silently lost — the row ends up stuck at DIALING forever.
  let bgapiParams: {
    gateway: string;
    dialDestination: string;
    computedBridgeTarget: string;
    bridgeApp: string;
    amdChannelVars: string[];
  } | null = null;
  if (campaign.dial_mode === 'live') {
    correlationId = randomUUID();
  }
  if (campaign.dial_mode === 'live') {
    // Iter 74 — multi-carrier routing. pickCarrierForPlan walks the
    // priority tiers, applies the dial-prefix gate AND a per-(plan,
    // carrier) port-cap gate, and returns null only when every tier
    // is exhausted. When that happens we bounce the lead to
    // CALLED_NO_ANSWER so it cycles back through cooldown instead of
    // being hammered on the next tick.
    const carrier = pickCarrierForPlan(plan.id, transformed);
    if (!carrier) {
      markLeadDialed(lead.lead_id, 'CALLED_NO_ANSWER');
      return { outcome: 'no_matching_prefix' };
    }
    pickedCarrierId = carrier.id;
    // Iter 45 — apply carrier rewrite rules. If a rule's match_prefix
    // matches, we strip it and prepend the next replacement on the
    // rotation cursor so 0805 → [310,311,312,…] traffic spreads
    // evenly. We don't mutate `transformed` because the dial_intent
    // row should still record what the route plan produced; the
    // rewritten value is what FS dials.
    let dialDestination = transformed;
    const matched = findMatchingDialPlanRule(carrier, transformed);
    if (matched) {
      const cursor = nextDialPlanCursor(carrier.id, matched.ruleIndex);
      dialDestination = applyDialPlanRule(matched.rule, transformed, cursor);
    }
    const gateway = `dialeros-${carrier.id}`;
    // Iter 55 — recording path. Flat layout keyed by correlation_id
    // so we never have to mkdir from inside FS; the path is set on
    // the dial_intent row at insert time so playback can find it
    // even if FS hasn't finished writing yet.
    recordingPath = `/var/lib/dialeros/recordings/${correlationId}.wav`;
    // Iter 39 — once the destination answers, bridge to the picked
    // agent. Local agent: ring their browser softphone via
    // user/<ext> (FS internal directory lookup). Remote agent:
    // INVITE the raw SIP URI on sofia/internal so the call lands on
    // the hard phone / partner trunk.
    //
    // Iter 40 — prefer the agent's primary phone extension if they
    // own one; fall back to the iter-35 hash for users without
    // phones so the migration is non-destructive.
    //
    // Iter 66 / 68 — campaign.amd_action overrides the bridge:
    //   drop      — &hangup. Used for connectivity probing / forced
    //               dropping rather than engaging an agent.
    //   voicemail — &playback(<voicemail_path>). Voice-blast mode:
    //               play the campaigns uploaded .wav at answer and
    //               hang up; no agent involvement.
    //   detect    — run amd_v2 via the dialeros-amd-route dialplan
    //               extension. HUMAN/NOTSURE -> bridge to agent;
    //               MACHINE -> voicemail-if-present, else hangup.
    //               Bridge target + voicemail path passed as channel
    //               vars (see amdChannelVars below).
    //   bridge (default) — the existing user/<ext> bridge.
    //
    // Iter 89 — bridge target is LOCAL agent only. Remotes are
    // ratio-dial seats, not bridge targets. If no local agent is
    // available, the bridge falls through to &hangup (= abandoned).
    let computedBridgeTarget: string;
    if (assigned) {
      const primary = getPrimaryPhoneForUser(assigned.id);
      const agentExtension =
        primary?.extension ?? extensionForUser(assigned.id);
      computedBridgeTarget = `user/${agentExtension}`;
    } else {
      // No local agent available — used only by AMD-detect's channel
      // var (empty string signals "no bridge target; treat HUMAN
      // path as abandoned" to the dialeros-amd-route extension).
      computedBridgeTarget = '';
    }

    let bridgeApp: string;
    const amdChannelVars: string[] = [];
    if (campaign.amd_action === 'drop') {
      bridgeApp = '&hangup';
    } else if (
      campaign.amd_action === 'voicemail' &&
      campaign.voicemail_path
    ) {
      bridgeApp = `&playback(${campaign.voicemail_path})`;
    } else if (campaign.amd_action === 'detect') {
      // Pass bridge target + (optional) voicemail path through
      // channel vars; the dialeros-amd-route dialplan extension
      // reads them and dispatches per amd_v2 result.
      amdChannelVars.push(`dialeros_bridge_target=${computedBridgeTarget}`);
      if (campaign.voicemail_path) {
        amdChannelVars.push(
          `dialeros_voicemail_path=${campaign.voicemail_path}`,
        );
      }
      bridgeApp = '&execute_extension(dialeros-amd-route XML default)';
    } else {
      // bridge mode. Need a real local target — if none, treat as
      // abandoned (call answers, instantly hangs up). Reports +
      // max_abandon% pick this up via hangup_cause / answered_at.
      bridgeApp = computedBridgeTarget
        ? `&bridge(${computedBridgeTarget})`
        : '&hangup';
    }
    // Iter 79 — INSERT the dial_intent row BEFORE issuing bgapi.
    // FreeSWITCH rejects bad routes faster than the bgapi await
    // resolves, and the CHANNEL_HANGUP_COMPLETE event hits the
    // listener while the row doesn't exist yet — leaving rows
    // stuck at DIALING forever. Pre-inserting with the
    // correlation_id closes the race; the originate result is
    // patched onto the same row right after the await.
    bgapiParams = {
      gateway,
      dialDestination,
      computedBridgeTarget,
      bridgeApp,
      amdChannelVars,
    };
    kind = 'originating';
  }

  const intent = insertDialIntent({
    campaign_id: campaignId,
    lead_id: lead.lead_id,
    assigned_user_id: assigned?.id ?? null,
    route_plan_id: plan.id,
    phone: lead.phone,
    transformed_phone: transformed,
    cid_used: cid,
    kind,
    call_uuid: null,
    originate_error: null,
    correlation_id: correlationId,
    recording_path: recordingPath,
    remote_agent_id: remoteAgent?.id ?? null,
    carrier_id: pickedCarrierId,
  });

  // Iter 79 — now do the actual bgapi. The row is already in the DB
  // with the correlation_id, so the FS-event listener can match
  // immediately. applyDialIntentOriginate patches the same row with
  // call_uuid / originate_error / final kind once bgapi returns.
  if (
    campaign.dial_mode === 'live' &&
    pickedCarrierId &&
    correlationId &&
    bgapiParams
  ) {
    try {
      const eslHost = pickEslHostForBridgeTarget(
        bgapiParams.computedBridgeTarget,
      );
      const jobUuid = await bgapiOriginate({
        gateway: bgapiParams.gateway,
        destination: bgapiParams.dialDestination,
        callerIdNumber: cid ?? undefined,
        correlationId,
        recordingPath: recordingPath ?? undefined,
        extraChannelVars:
          bgapiParams.amdChannelVars.length > 0
            ? bgapiParams.amdChannelVars
            : undefined,
        app: bgapiParams.bridgeApp,
        host: eslHost,
      });
      originateOutcome = { ok: true, job_uuid: jobUuid };
      applyDialIntentOriginate({
        id: intent.id,
        call_uuid: jobUuid,
        originate_error: null,
        kind: 'originated',
      });
      intent.kind = 'originated';
      intent.call_uuid = jobUuid;
    } catch (e) {
      const err = e as { message?: string };
      const msg = err.message ?? 'originate failed';
      originateOutcome = { ok: false, error: msg };
      applyDialIntentOriginate({
        id: intent.id,
        call_uuid: null,
        originate_error: msg,
        kind: 'originate_failed',
      });
      intent.kind = 'originate_failed';
      intent.originate_error = msg;
    }
    // Iter 78 — surface the post-bgapi state to the live SSE feed.
    // Without this the panel keeps the originating placeholder until
    // a hangup event lands.
    emitIntentUpdate(intent);
  }

  // Iter 34 — live calls go to DIALING (in-flight). The fs-events
  // listener overwrites this with the actual outcome derived from
  // hangup_cause (CALLED_ANSWERED / BUSY / CALLED_NO_ANSWER /
  // BAD_NUMBER / ...). Simulated calls keep the old optimistic
  // CALLED_NO_ANSWER mark since there's no real call to learn from.
  if (campaign.dial_mode === 'live') {
    markLeadDialed(lead.lead_id, 'DIALING');
  } else {
    markLeadDialed(lead.lead_id, 'CALLED_NO_ANSWER');
    // Iter 77 — simulated rows have no FS event flow to ever close
    // them, so without this they'd hang as "in-flight" forever and
    // saturate remote-agent line counts / carrier port caps. Close
    // immediately by stamping hangup_at = ts.
    closeSimulatedDialIntent(intent.id);
  }

  container().bus.emit(`intent:${campaignId}`, intent);
  container().bus.emit('intent:any', intent);

  return {
    outcome: 'dialed',
    intent,
    assigned_agent: assigned ?? undefined,
    originate: originateOutcome,
  };
}

export function startPacer(campaignId: string): boolean {
  const c = container();
  if (c.pacers.has(campaignId)) return false; // already running

  // Iter 21 — don't even spin up an interval for inbound-only campaigns.
  // They're driven by incoming calls, not by a pacer ticking on the dialer.
  const camp = getCampaignFromDb(campaignId);
  if (camp?.type === 'inbound_queue') return false;

  const tick = async () => {
    // Iter 49 / 58 — burst per tick. Pacing formula:
    //   target = floor((local_agents + Σ remote.lines_available) × dial_level)
    // Each iteration of paceCampaignOnce picks one slot from the
    // combined pool, originates, and advances cursors. Stop early
    // on any non-'dialed' outcome so we don't spin uselessly when
    // the hopper, agents, or carrier pool is exhausted.
    try {
      const c = getCampaignFromDb(campaignId);
      if (!c) return;
      // Iter 89 — pacing pool is REMOTE-LINES-ONLY when any remote
      // agent is attached. Remote agents are now strictly a "ratio
      // dialer seat count" — they do NOT receive bridges. Local
      // agents are bridge targets; counting them in the pacing pool
      // would over-fire on small operator teams. When no remote
      // agents are attached the pool falls back to the local agent
      // count so a 100% local campaign still paces normally.
      //   poolSize = remoteLinesTotal (if any remotes attached)
      //            = localAgents      (otherwise)
      //   target   = floor(poolSize × dial_level)
      // With 1 remote × 5 lines × dial_level 3 → 15 calls per tick.
      const localAgents = getAvailableAgentsForCampaign(campaignId);
      const remoteSlots = listRemoteAgentsWithCapacity(campaignId);
      const remoteLinesTotal = remoteSlots.reduce(
        (sum, r) => sum + r.agent.lines,
        0,
      );
      const poolSize =
        remoteLinesTotal > 0 ? remoteLinesTotal : localAgents.length;
      if (poolSize === 0) return;
      const target = Math.max(
        1,
        Math.floor(poolSize * (c.dial_level || 1)),
      );
      for (let i = 0; i < target; i++) {
        const result = await paceCampaignOnce(campaignId);
        if (result.outcome !== 'dialed') break;
      }
    } catch (e) {
      console.error(`[pacing] tick failed for ${campaignId}:`, e);
    }
  };

  // Run one tick immediately so the user sees activity right away,
  // then settle into the interval.
  tick();
  const handle = setInterval(tick, DEMO_INTERVAL_MS);
  // Don't keep the Node process alive solely for pacers.
  handle.unref();
  c.pacers.set(campaignId, handle);
  return true;
}

export function stopPacer(campaignId: string): boolean {
  const c = container();
  const h = c.pacers.get(campaignId);
  if (!h) return false;
  clearInterval(h);
  c.pacers.delete(campaignId);
  c.rotateState.delete(campaignId);
  return true;
}

export function isPacing(campaignId: string): boolean {
  return container().pacers.has(campaignId);
}

export function listPacingCampaignIds(): string[] {
  return [...container().pacers.keys()];
}

/**
 * Subscribe to dial intent events for a campaign. Returns an unsubscribe fn.
 */
export function subscribeToIntents(
  campaignId: string,
  fn: (intent: DialIntentRecord) => void,
): () => void {
  const channel = `intent:${campaignId}`;
  container().bus.on(channel, fn);
  return () => {
    container().bus.off(channel, fn);
  };
}

/**
 * Subscribe to ALL dial intents across every campaign. Used by the agent
 * console SSE, which then filters client-side / server-side by
 * assigned_user_id. Cheaper than walking every campaign individually.
 */
export function subscribeToAllIntents(
  fn: (intent: DialIntentRecord) => void,
): () => void {
  container().bus.on('intent:any', fn);
  return () => {
    container().bus.off('intent:any', fn);
  };
}

/**
 * Re-arm pacers for any campaign whose status is 'active' at startup.
 * Safe to call multiple times — startPacer is idempotent. Called from
 * the control-plane index on first import.
 *
 * Iter 33 — also kicks off the FS event listener if it isn't already
 * connected. The listener is what writes hangup_cause back onto
 * dial_intent rows for live calls.
 */
export function resumeActivePacers(): { started: number } {
  ensureFsEventListener();
  // Iter 56 — schedule the daily recording-retention sweep on the
  // same boot path. Idempotent + delayed-start so crash loops don't
  // hammer the filesystem.
  ensureRecordingRetentionSweep();
  // Iter 77 — boot-time + periodic sweep for stale dial_intents.
  // Without this, a live call whose FS event listener missed the
  // CHANNEL_DESTROY can pin a remote-agent line / carrier port
  // forever. One-shot reap at boot clears anything left behind by
  // the previous process; setInterval keeps things tidy at runtime.
  ensureIntentReaper();
  // Iter 61 — make sure the local box is registered as a node
  // (web + database + telephony) before anything else asks the
  // node table for a telephony host.
  ensureLocalNodeRegistered();
  // Iter 63 — auto-provision a primary phone for every user that
  // doesn't have one yet. Extension = username if digits, else
  // next free slot. Existing users from before iter 63 get
  // upgraded in place on first boot of this release.
  const filled = backfillUserPhones();
  if (filled.provisioned > 0) {
    // eslint-disable-next-line no-console
    console.info(
      `[boot] auto-provisioned primary phones for ${filled.provisioned} user(s)`,
    );
  }
  let started = 0;
  for (const c of listCampaignsFromDb()) {
    if (c.status === 'active') {
      if (startPacer(c.id)) started++;
    }
  }
  return { started };
}

/** Iter 78 — emit an intent update to the campaign's SSE bus so the
 * /campaigns/[id] real-time panel re-renders the row with its new
 * state (answered / hung up / cause). Called by the FS event
 * listener after applyDialIntentAnswered / applyDialIntentHangup
 * land their UPDATE. Without this, rows show "DIALING" forever even
 * though the DB has the final outcome. */
export function emitIntentUpdate(intent: DialIntentRecord): void {
  const c = container();
  c.bus.emit(`intent:${intent.campaign_id}`, intent);
  c.bus.emit('intent:any', intent);
}

/** Iter 77 — start the periodic stale-intent reaper if it isn't
 * already running. One-shot at startup + every 60s thereafter. Safe
 * to call repeatedly; the timer is stored on globalThis so hot
 * reloads don't double-schedule. */
function ensureIntentReaper(): void {
  // Boot pass — sweep whatever the previous process left hung.
  try {
    const n = reapStaleDialIntents(300);
    if (n > 0) {
      // eslint-disable-next-line no-console
      console.info(`[boot] reaped ${n} stale live dial intent(s)`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[boot] intent reaper failed', e);
  }
  const g = globalThis as typeof globalThis & {
    __dialeros_intent_reaper?: NodeJS.Timeout;
  };
  if (g.__dialeros_intent_reaper) return;
  g.__dialeros_intent_reaper = setInterval(() => {
    try {
      const n = reapStaleDialIntents(300);
      if (n > 0) {
        // eslint-disable-next-line no-console
        console.info(`[reaper] reaped ${n} stale live dial intent(s)`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[reaper] failed', e);
    }
  }, 60_000);
  // Don't hold the process open on the timer (lets unit tests exit).
  g.__dialeros_intent_reaper.unref?.();
}

export function listIntentsForCampaign(
  campaignId: string,
  limit = 100,
  sinceId = 0,
) {
  return listDialIntentsForCampaign(campaignId, limit, sinceId);
}

export function totalIntentsFor(campaignId: string): number {
  return countDialIntentsForCampaign(campaignId);
}

export type { DialIntentRecord, CampaignRecord };

// =====================================================================
// Iter 32 — minimal ESL bgapi helper (control-plane internal)
// =====================================================================
//
// Mirrors apps/admin-gui/lib/esl.ts but lives here so the pacer can
// originate without a circular dep on the admin-gui. Kept narrow:
// connect → auth → bgapi <command> → read +OK Job-UUID line → close.
//
// `bgapi` returns IMMEDIATELY with a job UUID; the actual call setup
// (RING / answer / hangup) happens asynchronously in FreeSWITCH. The
// pacer just wants to know "did we hand off the originate request?"
// — slow carrier handshakes don't block the tick loop.

interface BgapiOptions {
  gateway: string;
  destination: string;
  callerIdNumber?: string;
  /** Iter 33 — set as channel variable so hangup events can find the row. */
  correlationId?: string;
  /** Iter 55 — absolute path on disk where FS should write the .wav once
   * the call answers. Skipped when undefined (no recording). */
  recordingPath?: string;
  /** Iter 68 — extra channel vars (already key=value strings) appended
   * verbatim to the originate-time {} block. Used to pass
   * dialeros_bridge_target / dialeros_voicemail_path into the
   * amd-route dialplan extension. */
  extraChannelVars?: string[];
  app: string;
  host?: string;
  port?: number;
  password?: string;
  timeoutMs?: number;
}

const ESL_DEFAULTS = {
  host: '127.0.0.1',
  port: 8021,
  password: 'ClueCon',
  timeoutMs: 4000,
};

/**
 * Iter 69 — pick the right ESL endpoint for a bridge target. When
 * the bridge target is `user/<ext>` and the agent's phone is bound
 * to a non-self telephony node, originate via that node's ESL so
 * the call lands locally on the box that hosts the SIP directory.
 * Self-host (or no binding) stays on 127.0.0.1.
 *
 * For remote ESL the node has to:
 *  - run mod_event_socket bound on a reachable interface (default
 *    only listens on 127.0.0.1) and
 *  - share the ClueCon password (or admin-overridden) with this
 *    control-plane.
 * Single-box deploys never hit the remote branch so existing
 * installs continue to work unchanged.
 */
function eslHostForUserExtension(extension: string): string {
  // Find the phone by extension, then its bound telephony node.
  // Self-host (or no binding) stays on 127.0.0.1.
  const phone = getPhoneByExtension(extension);
  if (!phone || !phone.telephony_node_id) return '127.0.0.1';
  const node = getNodeFromDb(phone.telephony_node_id);
  if (!node) return '127.0.0.1';
  if (!parseNodeRoles(node).includes('telephony')) return '127.0.0.1';
  if (node.is_self === 1) return '127.0.0.1';
  return node.host;
}

function pickEslHostForBridgeTarget(bridgeTarget: string): string {
  // user/<ext>  → phone lookup
  // sofia/internal/<...> → first telephony node (remote agents
  //   don't carry an explicit telephony binding yet; iter-62
  //   adds that for phones, not remote agents).
  const userMatch = /^user\/([0-9a-zA-Z._*#@-]+)$/.exec(bridgeTarget);
  if (userMatch) return eslHostForUserExtension(userMatch[1]!);
  // Default: stay on the local box.
  return '127.0.0.1';
}

function bgapiOriginate(opts: BgapiOptions): Promise<string> {
  const cfg = { ...ESL_DEFAULTS, ...opts };
  const channelVars: string[] = [];
  if (opts.callerIdNumber) {
    const cid = escapeChannelValue(opts.callerIdNumber);
    channelVars.push(`origination_caller_id_number=${cid}`);
    // Force the SIP From: user to match — see lib/esl.ts comment.
    channelVars.push(`sip_from_user=${cid}`);
  }
  if (opts.correlationId) {
    channelVars.push(
      `dialeros_correlation_id=${escapeChannelValue(opts.correlationId)}`,
    );
  }
  channelVars.push('ignore_early_media=true');
  channelVars.push('hangup_after_bridge=true');
  if (opts.recordingPath) {
    // Iter 55 — start a stereo .wav on answer. record_session runs
    // once the leg is up (or once the bridged leg answers, since
    // execute_on_answer fires on the originated leg's CHANNEL_ANSWER).
    // FS writes a/b legs to L/R channels so QA can hear each side
    // separately on playback.
    // Iter 79 — wrap the value in single quotes. Without quoting, the
    // space between `record_session` and the path breaks FS's
    // channel-var parser ("Parse Error!" in switch_ivr_originate.c),
    // the originate is silently rejected before a channel is created,
    // and no CHANNEL_HANGUP_COMPLETE ever fires — so the listener
    // never matches and rows stay stuck at DIALING forever. FS
    // accepts `key='value with spaces'` inside the {…} block.
    channelVars.push(
      `execute_on_answer='record_session ${escapeChannelValue(opts.recordingPath)}'`,
    );
    channelVars.push('RECORD_STEREO=true');
  }
  if (opts.extraChannelVars && opts.extraChannelVars.length > 0) {
    // Iter 68 — caller already formatted these as key=value pairs.
    for (const kv of opts.extraChannelVars) channelVars.push(kv);
  }
  const vars = `{${channelVars.join(',')}}`;
  const dial = `${vars}sofia/gateway/${opts.gateway}/${opts.destination}`;
  const cmd = `bgapi originate ${dial} ${opts.app}`;

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: cfg.host, port: cfg.port });
    socket.setEncoding('utf8');
    socket.setTimeout(cfg.timeoutMs);

    let buffer = '';
    let phase: 'auth-req' | 'auth-reply' | 'bgapi-reply' = 'auth-req';

    const fail = (code: string, msg: string) => {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      const err = new Error(msg);
      (err as { code?: string }).code = code;
      reject(err);
    };

    socket.on('error', (e) => fail('connect_failed', e.message));
    socket.on('timeout', () =>
      fail('timeout', `bgapi timed out after ${cfg.timeoutMs}ms`),
    );

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      while (true) {
        const sep = buffer.indexOf('\n\n');
        if (sep === -1) return;
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const headers = parseHeaders(block);

        if (phase === 'auth-req') {
          if (headers['content-type'] !== 'auth/request') {
            return fail(
              'unexpected_state',
              `expected auth/request, got ${headers['content-type']}`,
            );
          }
          phase = 'auth-reply';
          socket.write(`auth ${cfg.password}\n\n`);
          continue;
        }
        if (phase === 'auth-reply') {
          if (!headers['reply-text']?.startsWith('+OK')) {
            return fail('auth_failed', headers['reply-text'] ?? 'auth failed');
          }
          phase = 'bgapi-reply';
          socket.write(`${cmd}\n\n`);
          continue;
        }
        if (phase === 'bgapi-reply') {
          const reply = headers['reply-text'] ?? '';
          // Expected: "+OK Job-UUID: <uuid>" — the Job-UUID header is also
          // separately set, prefer that when present.
          const jobUuid =
            headers['job-uuid'] ??
            reply.match(/Job-UUID:\s*([a-f0-9-]+)/i)?.[1];
          if (jobUuid) {
            try {
              socket.end();
              socket.destroy();
            } catch {
              /* ignore */
            }
            resolve(jobUuid);
            return;
          }
          return fail('originate_failed', reply || 'no Job-UUID in reply');
        }
      }
    });
  });
}

function parseHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    out[k] = v;
  }
  return out;
}

function escapeChannelValue(v: string): string {
  return v.replace(/[,{}'\n\r]/g, '_');
}

/** Iter 88 — synchronous ESL `api` call returning the body string.
 * Used by isUserRegistered() and similar single-shot diagnostics
 * that don't need the bgapi-job-uuid round-trip. Connects, authes,
 * runs `api <cmd>`, reads the body, closes. Times out at 1500ms by
 * default so the campaign page render isn't hostage to a slow FS. */
function eslApi(
  cmd: string,
  opts: { host?: string; port?: number; password?: string; timeoutMs?: number } = {},
): Promise<string> {
  const cfg = {
    host: opts.host ?? ESL_DEFAULTS.host,
    port: opts.port ?? ESL_DEFAULTS.port,
    password: opts.password ?? ESL_DEFAULTS.password,
    timeoutMs: opts.timeoutMs ?? 1500,
  };
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: cfg.host, port: cfg.port });
    socket.setEncoding('utf8');
    socket.setTimeout(cfg.timeoutMs);
    let buffer = '';
    let phase: 'auth-req' | 'auth-reply' | 'api-headers' | 'api-body' =
      'auth-req';
    let bodyLen = 0;
    const fail = (msg: string) => {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      reject(new Error(msg));
    };
    socket.on('error', (e) => fail(e.message));
    socket.on('timeout', () => fail(`esl api timeout: ${cmd}`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      while (true) {
        if (phase === 'api-body') {
          if (buffer.length < bodyLen) return;
          const body = buffer.slice(0, bodyLen);
          try {
            socket.end();
            socket.destroy();
          } catch {
            /* ignore */
          }
          resolve(body);
          return;
        }
        const sep = buffer.indexOf('\n\n');
        if (sep === -1) return;
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const headers = parseHeaders(block);
        if (phase === 'auth-req') {
          if (headers['content-type'] !== 'auth/request') {
            return fail(`expected auth/request, got ${headers['content-type']}`);
          }
          phase = 'auth-reply';
          socket.write(`auth ${cfg.password}\n\n`);
          continue;
        }
        if (phase === 'auth-reply') {
          if (!headers['reply-text']?.startsWith('+OK')) {
            return fail(headers['reply-text'] ?? 'auth failed');
          }
          phase = 'api-headers';
          socket.write(`api ${cmd}\n\n`);
          continue;
        }
        if (phase === 'api-headers') {
          // FS responds with Content-Type: api/response\nContent-Length: N\n\n<body>
          if (headers['content-type'] !== 'api/response') {
            return fail(
              `expected api/response, got ${headers['content-type']}`,
            );
          }
          bodyLen = Number(headers['content-length'] ?? '0');
          if (bodyLen === 0) {
            try {
              socket.end();
              socket.destroy();
            } catch {
              /* ignore */
            }
            resolve('');
            return;
          }
          phase = 'api-body';
          continue;
        }
      }
    });
  });
}

/** Iter 88 — is this user/extension currently registered with the
 * given sofia profile? Uses `sofia_contact <profile>/<user>@<host>`
 * which returns `error/user_not_registered` when not registered,
 * or a contact URI like `sofia/internal/sip:abc@…` when it is.
 * Defaults to the `internal` profile because that's where browser
 * softphones + remote-agent endpoints live. */
export async function isUserRegistered(
  user: string,
  host: string,
  profile = 'internal',
  eslHost?: string,
): Promise<boolean> {
  try {
    const body = await eslApi(`sofia_contact ${profile}/${user}@${host}`, {
      host: eslHost ?? '127.0.0.1',
    });
    const trimmed = body.trim();
    if (!trimmed) return false;
    return !trimmed.toLowerCase().startsWith('error');
  } catch {
    // FS unreachable / timeout — treat as "unknown" → false. Caller
    // surfaces a yellow "unable to verify" state if it wants finer
    // semantics; right now a registered/not-registered binary is
    // enough for the warning banner.
    return false;
  }
}
