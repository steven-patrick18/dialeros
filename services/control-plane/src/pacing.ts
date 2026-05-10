import { EventEmitter } from 'node:events';
import {
  countDialIntentsForCampaign,
  getActiveAgentsForCampaign,
  getCampaignFromDb,
  getRoutePlanFromDb,
  insertDialIntent,
  listCampaignsFromDb,
  listDialIntentsForCampaign,
  markLeadDialed,
  pickNextDialableLead,
  type CampaignRecord,
  type DialIntentRecord,
} from './db';
import { parseCidPool } from './route-plan';

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
    };
  }
  // Older sessions might predate agentRotateState — patch defensively
  // so HMR-cached containers don't crash on the new field.
  const c = globalThis.__dialeros_pacing!;
  if (!c.agentRotateState) c.agentRotateState = new Map();
  return c;
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

function pickCid(
  campaign_id: string,
  strategy: string,
  single: string | null,
  pool: string[],
): string | null {
  if (strategy === 'single') return single;
  if (strategy === 'rotate' && pool.length > 0) {
    const c = container();
    const cursor = c.rotateState.get(campaign_id) ?? 0;
    const cid = pool[cursor % pool.length] ?? null;
    c.rotateState.set(campaign_id, cursor + 1);
    return cid;
  }
  return null; // passthrough — campaign / lead-level CID logic added later
}

export interface PacingTickResult {
  outcome:
    | 'dialed'
    | 'no_route_plan'
    | 'no_lead'
    | 'no_agents'
    | 'campaign_missing'
    | 'campaign_inactive';
  intent?: DialIntentRecord;
  assigned_agent?: { id: string; username: string };
}

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

/**
 * Run a single pacing tick for a campaign. Exported for tests + manual
 * "Dial next" buttons.
 *
 * Iter 16 — agent-aware. The pacer only fires if at least one active
 * agent is attached to the campaign. With telephony absent, every
 * attached agent is treated as "always AVAILABLE"; real online state
 * (LOGGED_IN, ON_CALL, WRAP_UP, PAUSED) lands with the agent UI.
 */
export function paceCampaignOnce(campaignId: string): PacingTickResult {
  const campaign = getCampaignFromDb(campaignId);
  if (!campaign) return { outcome: 'campaign_missing' };
  if (campaign.status !== 'active') return { outcome: 'campaign_inactive' };

  const plan = getRoutePlanFromDb(campaign.route_plan_id);
  if (!plan) return { outcome: 'no_route_plan' };

  const agents = getActiveAgentsForCampaign(campaignId);
  if (agents.length === 0) return { outcome: 'no_agents' };

  const lead = pickNextDialableLead(campaignId, COOLDOWN_SECONDS);
  if (!lead) return { outcome: 'no_lead' };

  const assigned = pickAgent(campaignId, agents)!;

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
  );

  const intent = insertDialIntent({
    campaign_id: campaignId,
    lead_id: lead.lead_id,
    assigned_user_id: assigned.id,
    route_plan_id: plan.id,
    phone: lead.phone,
    transformed_phone: transformed,
    cid_used: cid,
    kind: 'simulated',
  });

  markLeadDialed(lead.lead_id, 'CALLED_NO_ANSWER');

  container().bus.emit(`intent:${campaignId}`, intent);
  container().bus.emit('intent:any', intent);

  return { outcome: 'dialed', intent, assigned_agent: assigned };
}

export function startPacer(campaignId: string): boolean {
  const c = container();
  if (c.pacers.has(campaignId)) return false; // already running

  const tick = () => {
    try {
      paceCampaignOnce(campaignId);
    } catch (e) {
      // never crash the pacer loop on a single bad lead / DB blip;
      // log and continue.
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
 */
export function resumeActivePacers(): { started: number } {
  let started = 0;
  for (const c of listCampaignsFromDb()) {
    if (c.status === 'active') {
      if (startPacer(c.id)) started++;
    }
  }
  return { started };
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
