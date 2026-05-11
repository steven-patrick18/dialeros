import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  attachCampaignInGroups,
  attachCampaignLeadLists,
  deleteCampaignFromDb,
  getCampaignFromDb,
  getCampaignInGroupIds,
  getCampaignLeadListIds,
  getInGroupFromDb,
  getLeadListFromDb,
  getRoutePlanFromDb,
  insertCampaign,
  listCampaignsFromDb,
  listCampaignsUsingLeadList,
  listCampaignsUsingRoutePlan,
  setCampaignInGroups,
  updateCampaignFields,
  updateCampaignStatusInDb,
  type CampaignRecord,
} from './db';

// Iter 21 — types that drive outbound dialing (need a lead list).
// inbound_queue waits for calls to arrive at attached in-groups.
// blended can do both — we treat lead list as optional and let the
// pacer decide based on what's attached.
const OUTBOUND_TYPES = new Set([
  'outbound_manual',
  'outbound_progressive',
  'outbound_predictive',
  'outbound_preview',
  'survey',
]);

// All seven campaign types from spec §6. Some require features that arrive
// in later iters — the type can be CONFIGURED today, the runtime behavior
// activates once the dependency lands:
//   outbound_manual       — agent triggers each dial (works today)
//   outbound_progressive  — system dials 1:1 when agent ready (needs pacing, iter 11)
//   outbound_predictive   — >1:1, manages drop rate (needs pacing, iter 11)
//   outbound_preview      — agent previews before dial (needs in-call UI, iter 12+)
//   inbound_queue         — DIDs route to this campaign (needs in-groups, this iter)
//   survey                — outbound to call menu, no agent (needs IVR, iter 12+)
//   blended               — same pool handles inbound + outbound (needs both)
export const CampaignTypeSchema = z.enum([
  'outbound_manual',
  'outbound_progressive',
  'outbound_predictive',
  'outbound_preview',
  'inbound_queue',
  'survey',
  'blended',
]);
export type CampaignType = z.infer<typeof CampaignTypeSchema>;

export const CampaignStatusSchema = z.enum(['paused', 'active', 'archived']);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

// Iter 32 — opt-in real dialing. Default 'simulated' so an admin who
// just sets a campaign to ACTIVE doesn't accidentally place real calls.
export const DialModeSchema = z.enum(['simulated', 'live']);
export type DialMode = z.infer<typeof DialModeSchema>;

const TimeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM 24-hour format.');

export const CampaignInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.'),
    description: z.string().max(500).optional(),
    type: CampaignTypeSchema.default('outbound_manual'),
    route_plan_id: z.string().uuid('route_plan_id must be a UUID.'),
    lead_list_ids: z.array(z.string().uuid()).default([]),
    in_group_ids: z.array(z.string().uuid()).default([]),
    base_ratio: z.number().min(0.5).max(10).default(1.0),
    call_window_start: TimeOfDay.optional(),
    call_window_end: TimeOfDay.optional(),
    max_abandon_pct: z.number().min(0).max(100).default(3.0),
    dial_mode: DialModeSchema.default('simulated'),
  })
  .refine(
    (d) => {
      // If one window bound is set, the other must be too.
      const a = d.call_window_start;
      const b = d.call_window_end;
      return (a == null && b == null) || (a != null && b != null);
    },
    {
      message:
        'call_window_start and call_window_end must both be set or both be empty.',
      path: ['call_window_end'],
    },
  )
  .refine(
    (d) => !OUTBOUND_TYPES.has(d.type) || d.lead_list_ids.length > 0,
    {
      message:
        'Outbound and survey campaigns must attach at least one lead list.',
      path: ['lead_list_ids'],
    },
  )
  .refine(
    (d) => d.type !== 'inbound_queue' || d.in_group_ids.length > 0,
    {
      message: 'Inbound campaigns must attach at least one in-group.',
      path: ['in_group_ids'],
    },
  );
export type CampaignInput = z.infer<typeof CampaignInputSchema>;

export interface CreateCampaignResult {
  id: string;
}

export function createCampaign(input: CampaignInput): CreateCampaignResult {
  // Validate referenced rows exist.
  if (!getRoutePlanFromDb(input.route_plan_id)) {
    throw new Error(`Route plan ${input.route_plan_id} not found.`);
  }
  for (const lid of input.lead_list_ids) {
    if (!getLeadListFromDb(lid)) {
      throw new Error(`Lead list ${lid} not found.`);
    }
  }
  for (const gid of input.in_group_ids) {
    if (!getInGroupFromDb(gid)) {
      throw new Error(`In-group ${gid} not found.`);
    }
  }

  const id = randomUUID();
  insertCampaign({
    id,
    name: input.name,
    description: input.description ?? null,
    type: input.type,
    route_plan_id: input.route_plan_id,
    base_ratio: input.base_ratio,
    call_window_start: input.call_window_start ?? null,
    call_window_end: input.call_window_end ?? null,
    max_abandon_pct: input.max_abandon_pct,
    dial_mode: input.dial_mode,
  });
  attachCampaignLeadLists(id, input.lead_list_ids);
  attachCampaignInGroups(id, input.in_group_ids);
  return { id };
}

export function listCampaigns(): CampaignRecord[] {
  return listCampaignsFromDb();
}

export function getCampaign(id: string): CampaignRecord | undefined {
  return getCampaignFromDb(id);
}

export function getCampaignLeadLists(campaignId: string): string[] {
  return getCampaignLeadListIds(campaignId);
}

export function getCampaignInGroups(campaignId: string): string[] {
  return getCampaignInGroupIds(campaignId);
}

/**
 * Iter 21 — replace the campaign's in-group attachment with the given
 * set. Validates each id exists. Use this from edit forms; the create
 * path uses attachCampaignInGroups directly.
 */
export function setCampaignInGroupAttachment(
  campaignId: string,
  inGroupIds: string[],
): void {
  if (!getCampaignFromDb(campaignId)) {
    throw new Error(`Campaign ${campaignId} not found.`);
  }
  for (const gid of inGroupIds) {
    if (!getInGroupFromDb(gid)) {
      throw new Error(`In-group ${gid} not found.`);
    }
  }
  setCampaignInGroups(campaignId, inGroupIds);
}

export function deleteCampaign(id: string): boolean {
  return deleteCampaignFromDb(id);
}

export function setCampaignStatus(
  id: string,
  status: CampaignStatus,
): boolean {
  return updateCampaignStatusInDb(id, status);
}

export function getCampaignsForRoutePlan(
  routePlanId: string,
): CampaignRecord[] {
  return listCampaignsUsingRoutePlan(routePlanId);
}

export function getCampaignsForLeadList(
  leadListId: string,
): CampaignRecord[] {
  return listCampaignsUsingLeadList(leadListId);
}

// Iter 14: edit. Only the simple fields — route_plan_id and attached
// lead lists are intentionally NOT mutable here. Changing those
// disrupts active dialing; require delete + recreate for clarity.
export const CampaignUpdateInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.')
      .optional(),
    description: z.string().max(500).optional(),
    type: CampaignTypeSchema.optional(),
    dial_mode: DialModeSchema.optional(),
    base_ratio: z.number().min(0.5).max(10).optional(),
    call_window_start: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM 24-hour format.')
      .optional()
      .or(z.literal('').transform(() => null)),
    call_window_end: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM 24-hour format.')
      .optional()
      .or(z.literal('').transform(() => null)),
    max_abandon_pct: z.number().min(0).max(100).optional(),
    // Iter 49 — hopper + dial level.
    hopper_level: z.number().int().min(1).max(10000).optional(),
    dial_level: z.number().min(0.1).max(10).optional(),
    // Iter 66 / 68 — answering-machine handling. `voicemail_path`
    // is managed via the campaign-detail upload form, not this
    // PATCH; it's listed here so the inline-edit pass-through is
    // harmless.
    //
    //   bridge    — connect lead to agent (default; iter 39).
    //   drop      — &hangup at answer; no audio (iter 66).
    //   voicemail — &playback(<file>) at answer; no agent (iter 66).
    //   detect    — run amd_v2 at answer; HUMAN/NOTSURE -> bridge to
    //               agent, MACHINE -> playback voicemail (if set)
    //               then hangup, else just hangup (iter 68).
    amd_action: z.enum(['bridge', 'drop', 'voicemail', 'detect']).optional(),
    voicemail_path: z
      .string()
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
    // Iter 70 — list-order strategy. RANDOM picks each refill at
    // random; UP_TIME walks oldest leads first (clear backlog);
    // DOWN_TIME walks newest first (work fresh imports).
    list_order: z.enum(['RANDOM', 'UP_TIME', 'DOWN_TIME']).optional(),
  })
  .refine(
    (d) => {
      // call_window_start and call_window_end must be both-or-neither.
      // Treat undefined (not in patch) as "leave alone"; only enforce
      // both-or-neither when at least one is being set in this call.
      const aTouched = d.call_window_start !== undefined;
      const bTouched = d.call_window_end !== undefined;
      if (!aTouched && !bTouched) return true;
      const a = d.call_window_start;
      const b = d.call_window_end;
      // Both must be set (non-null/non-empty) or both must be cleared (null).
      return (a == null && b == null) || (!!a && !!b);
    },
    {
      message:
        'call_window_start and call_window_end must both be set or both be cleared.',
      path: ['call_window_end'],
    },
  );
export type CampaignUpdateInput = z.infer<typeof CampaignUpdateInputSchema>;

export function updateCampaign(
  id: string,
  input: CampaignUpdateInput,
): boolean {
  if (!getCampaignFromDb(id)) {
    throw new Error(`Campaign ${id} not found`);
  }
  const updates: Parameters<typeof updateCampaignFields>[1] = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) {
    updates.description = input.description || null;
  }
  if (input.type !== undefined) updates.type = input.type;
  if (input.dial_mode !== undefined) updates.dial_mode = input.dial_mode;
  if (input.base_ratio !== undefined) updates.base_ratio = input.base_ratio;
  if (input.call_window_start !== undefined) {
    updates.call_window_start = input.call_window_start || null;
  }
  if (input.call_window_end !== undefined) {
    updates.call_window_end = input.call_window_end || null;
  }
  if (input.max_abandon_pct !== undefined) {
    updates.max_abandon_pct = input.max_abandon_pct;
  }
  if (input.hopper_level !== undefined) updates.hopper_level = input.hopper_level;
  if (input.dial_level !== undefined) updates.dial_level = input.dial_level;
  if (input.amd_action !== undefined) updates.amd_action = input.amd_action;
  if (input.voicemail_path !== undefined) {
    updates.voicemail_path = input.voicemail_path ?? null;
  }
  if (input.list_order !== undefined) updates.list_order = input.list_order;
  return updateCampaignFields(id, updates);
}

export type { CampaignRecord } from './db';
