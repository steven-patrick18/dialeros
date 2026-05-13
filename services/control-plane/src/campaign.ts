import { randomUUID } from 'crypto';
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

/** Iter 128 — clone a campaign. Carries over every operator-
 * configurable field (route plan, pacing, AMD, dial windows,
 * list order, dialable statuses, voicemail path, in-group
 * attachments) so the new campaign is ready to tune rather than
 * built from scratch.
 *
 * Deliberately does NOT carry:
 *   - status — clone is created paused; operator unpauses when
 *              ready (matches createCampaign default).
 *   - lead_list_ids — separate flag because attaching the same
 *              lists doubles the dialing pressure on those leads
 *              (both campaigns paced against the same pool).
 *              Default false; operator opts in when they want a
 *              second pass with different routing on the same
 *              leads.
 *   - dial_intents — call history doesn't carry; the new
 *              campaign starts at zero.
 *
 * The new name must be unique; campaigns.name is UNIQUE in the
 * schema and we surface the conflict as a clear error. */
export function cloneCampaign(
  sourceId: string,
  newName: string,
  opts: { include_lead_lists?: boolean } = {},
): CreateCampaignResult {
  const src = getCampaignFromDb(sourceId);
  if (!src) {
    throw new Error(`Source campaign ${sourceId} not found.`);
  }
  if (!newName || newName.trim().length === 0) {
    throw new Error('New campaign name is required.');
  }
  if (listCampaignsFromDb().some((c) => c.name === newName)) {
    throw new Error(`A campaign named "${newName}" already exists.`);
  }

  const id = randomUUID();
  insertCampaign({
    id,
    name: newName,
    description: src.description,
    type: src.type,
    route_plan_id: src.route_plan_id,
    base_ratio: src.base_ratio,
    call_window_start: src.call_window_start,
    call_window_end: src.call_window_end,
    max_abandon_pct: src.max_abandon_pct,
    dial_mode: src.dial_mode,
  });

  // ALTER-only columns (iter 49 hopper, iter 66 AMD, iter 70
  // list_order, iter 94 dialable_statuses) live in the same
  // row but aren't part of insertCampaign's signature. Fold
  // them in via the partial-update helper so the clone is a
  // faithful copy.
  updateCampaignFields(id, {
    hopper_level: src.hopper_level,
    dial_level: src.dial_level,
    amd_action: src.amd_action,
    voicemail_path: src.voicemail_path,
    list_order: src.list_order,
    dialable_statuses: src.dialable_statuses,
  });

  // In-groups always carry — inbound queues aren't a dialing
  // pool, attaching the same in-group to a clone just means both
  // campaigns route inbound from the same DIDs.
  const inGroups = getCampaignInGroupIds(sourceId);
  attachCampaignInGroups(id, inGroups);

  // Lead lists are opt-in to avoid accidentally double-pacing the
  // same leads. When opted in we re-attach every list the source
  // had.
  if (opts.include_lead_lists) {
    const listIds = getCampaignLeadListIds(sourceId);
    attachCampaignLeadLists(id, listIds);
  }

  return { id };
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
    // Iter 154 — ViciDial-parity on-answer options.
    //   bridge      — connect lead to agent (default)
    //   drop        — &hangup at answer
    //   voicemail   — &playback(<voicemail_path>) + hangup (voice-blast)
    //   audio_drop  — &playback(<audio_drop_path>) + hangup (compliance ext 8373)
    //   call_menu   — execute_extension call_menu_<on_answer_call_menu_id> (ext 8366)
    //   detect      — amd_v2 inline; HUMAN goes to amd_human_action,
    //                 MACHINE goes to amd_machine_action.
    amd_action: z
      .enum([
        'bridge',
        'drop',
        'voicemail',
        'detect',
        'call_menu',
        'audio_drop',
      ])
      .optional(),
    on_answer_call_menu_id: z.string().nullable().optional()
      .or(z.literal('').transform(() => null)),
    audio_drop_path: z.string().nullable().optional()
      .or(z.literal('').transform(() => null)),
    // detect mode sub-actions
    amd_human_action: z
      .enum(['bridge', 'call_menu', 'drop'])
      .optional(),
    amd_human_call_menu_id: z.string().nullable().optional()
      .or(z.literal('').transform(() => null)),
    amd_machine_action: z
      .enum(['voicemail', 'audio_drop', 'call_menu', 'drop'])
      .optional(),
    amd_machine_call_menu_id: z.string().nullable().optional()
      .or(z.literal('').transform(() => null)),
    amd_machine_audio_path: z.string().nullable().optional()
      .or(z.literal('').transform(() => null)),
    voicemail_path: z
      .string()
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
    // Iter 70 — list-order strategy. RANDOM picks each refill at
    // random; UP_TIME walks oldest leads first (clear backlog);
    // DOWN_TIME walks newest first (work fresh imports).
    // Iter 91 — TZ_* variants only feed leads whose inferred TZ is
    // currently inside the campaign's call window. Order semantics
    // mirror the non-TZ variants (random / oldest / newest).
    list_order: z
      .enum([
        'RANDOM',
        'UP_TIME',
        'DOWN_TIME',
        'TZ_RANDOM',
        'TZ_UP_TIME',
        'TZ_DOWN_TIME',
      ])
      .optional(),
    // Iter 94 — per-campaign whitelist of lead statuses the pacer
    // is allowed to dial. Empty = nothing dials (operator can
    // pause-by-whitelist). Validates each entry against the lead
    // status enum so a typo can't silently turn off dialing.
    voicemail_config: z
    .string()
    .nullable()
    .optional(),
  dialable_statuses: z
      .array(
        z.enum([
          'NEW',
          'CALLED_NO_ANSWER',
          'BUSY',
          'CALLBACK_SCHEDULED',
          'CONVERTED',
          'DNC',
          'DNC_TEMP',
          'BAD_NUMBER',
          'DIALING',
        ]),
      )
      .min(1, 'Pick at least one dialable status.')
      .optional(),
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
  if (input.on_answer_call_menu_id !== undefined)
    updates.on_answer_call_menu_id = input.on_answer_call_menu_id;
  if (input.audio_drop_path !== undefined)
    updates.audio_drop_path = input.audio_drop_path;
  if (input.amd_human_action !== undefined)
    updates.amd_human_action = input.amd_human_action;
  if (input.amd_human_call_menu_id !== undefined)
    updates.amd_human_call_menu_id = input.amd_human_call_menu_id;
  if (input.amd_machine_action !== undefined)
    updates.amd_machine_action = input.amd_machine_action;
  if (input.amd_machine_call_menu_id !== undefined)
    updates.amd_machine_call_menu_id = input.amd_machine_call_menu_id;
  if (input.amd_machine_audio_path !== undefined)
    updates.amd_machine_audio_path = input.amd_machine_audio_path;
  if (input.voicemail_path !== undefined) {
    updates.voicemail_path = input.voicemail_path ?? null;
  }
  if (input.list_order !== undefined) updates.list_order = input.list_order;
  if (input.dialable_statuses !== undefined) {
    updates.dialable_statuses = JSON.stringify(input.dialable_statuses);
  }
  if (input.voicemail_config !== undefined) {
    updates.voicemail_config = input.voicemail_config;
  }
  return updateCampaignFields(id, updates);
}

export type { CampaignRecord } from './db';

// Iter 140 — per-campaign voicemail-drop tuning. The five values
// thread through to the dialplan as channel vars at originate
// time. Defaults match the iter-139 dialplan baked-ins so an
// unconfigured campaign behaves identically.
export interface VoicemailConfig {
  silence_thresh: number;
  silence_hits: number;
  listen_hits: number;
  silence_timeout_ms: number;
  beep_grace_ms: number;
}

export const VOICEMAIL_CONFIG_DEFAULTS: VoicemailConfig = {
  silence_thresh: 256,
  silence_hits: 25,
  listen_hits: 4,
  silence_timeout_ms: 30_000,
  beep_grace_ms: 750,
};

export const VoicemailConfigSchema = z.object({
  silence_thresh: z.number().int().min(50).max(10_000),
  silence_hits: z.number().int().min(5).max(500),
  listen_hits: z.number().int().min(1).max(50),
  silence_timeout_ms: z.number().int().min(2_000).max(120_000),
  beep_grace_ms: z.number().int().min(0).max(5_000),
});

/** Parse the JSON column with the defaults filled in for any
 * missing or invalid field. Tolerant — corrupt config can't
 * take down the pacer; we just fall back to defaults. */
export function getVoicemailConfig(
  campaign: { voicemail_config: string | null },
): VoicemailConfig {
  const raw = campaign.voicemail_config;
  if (!raw) return { ...VOICEMAIL_CONFIG_DEFAULTS };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const v = VoicemailConfigSchema.safeParse({
      silence_thresh: parsed.silence_thresh,
      silence_hits: parsed.silence_hits,
      listen_hits: parsed.listen_hits,
      silence_timeout_ms: parsed.silence_timeout_ms,
      beep_grace_ms: parsed.beep_grace_ms,
    });
    if (v.success) return v.data;
  } catch {
    /* corrupted — fall through */
  }
  return { ...VOICEMAIL_CONFIG_DEFAULTS };
}

