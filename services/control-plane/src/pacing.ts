import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import {
  countDialIntentsForCampaign,
  getAvailableAgentsForCampaign,
  getCampaignFromDb,
  getCarrierFromDb,
  getPrimaryPhoneForUser,
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
import { ensureFsEventListener } from './fs-events';
import { extensionForUser } from './sip-extensions';

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
    | 'no_carrier'
    | 'outside_window'
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
  const agents = getAvailableAgentsForCampaign(campaignId);
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
  if (campaign.dial_mode === 'live') {
    const carrier = getCarrierFromDb(plan.primary_carrier_id);
    if (!carrier) {
      return { outcome: 'no_carrier' };
    }
    correlationId = randomUUID();
    const gateway = `dialeros-${carrier.id}`;
    // Iter 39 — once the destination answers, ring the assigned agent's
    // browser softphone (registered as user/<ext> in FS). FS bridges the
    // two legs, so the agent hears + talks to the lead through their
    // browser. If the agent isn't registered, the bridge fails and
    // hangup_after_bridge tears the call down — surfaces as
    // NORMAL_TEMPORARY_FAILURE in the hangup_cause column.
    //
    // Iter 40 — prefer the agent's primary phone extension if they own
    // one; fall back to the iter-35 hash for users without phones so
    // the migration is non-destructive.
    const primary = getPrimaryPhoneForUser(assigned.id);
    const agentExtension = primary?.extension ?? extensionForUser(assigned.id);
    try {
      const jobUuid = await bgapiOriginate({
        gateway,
        destination: transformed,
        callerIdNumber: cid ?? undefined,
        correlationId,
        app: `&bridge(user/${agentExtension})`,
      });
      originateOutcome = { ok: true, job_uuid: jobUuid };
      kind = 'originated';
    } catch (e) {
      const err = e as { message?: string };
      originateOutcome = {
        ok: false,
        error: err.message ?? 'originate failed',
      };
      kind = 'originate_failed';
    }
  }

  const intent = insertDialIntent({
    campaign_id: campaignId,
    lead_id: lead.lead_id,
    assigned_user_id: assigned.id,
    route_plan_id: plan.id,
    phone: lead.phone,
    transformed_phone: transformed,
    cid_used: cid,
    kind,
    call_uuid: originateOutcome?.ok ? originateOutcome.job_uuid : null,
    originate_error:
      originateOutcome && !originateOutcome.ok ? originateOutcome.error : null,
    correlation_id: correlationId,
  });

  // Iter 34 — live calls go to DIALING (in-flight). The fs-events
  // listener overwrites this with the actual outcome derived from
  // hangup_cause (CALLED_ANSWERED / BUSY / CALLED_NO_ANSWER /
  // BAD_NUMBER / ...). Simulated calls keep the old optimistic
  // CALLED_NO_ANSWER mark since there's no real call to learn from.
  if (campaign.dial_mode === 'live') {
    markLeadDialed(lead.lead_id, 'DIALING');
  } else {
    markLeadDialed(lead.lead_id, 'CALLED_NO_ANSWER');
  }

  container().bus.emit(`intent:${campaignId}`, intent);
  container().bus.emit('intent:any', intent);

  return {
    outcome: 'dialed',
    intent,
    assigned_agent: assigned,
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

  const tick = () => {
    // paceCampaignOnce is async (iter 32 — may await ESL). We treat each
    // tick as fire-and-forget here: errors are logged but never crash the
    // pacer loop. setInterval doesn't await, but a tick that takes longer
    // than DEMO_INTERVAL_MS just overlaps the next one — bgapi is fast
    // enough (~50ms) that this is fine.
    paceCampaignOnce(campaignId).catch((e: unknown) => {
      console.error(`[pacing] tick failed for ${campaignId}:`, e);
    });
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
