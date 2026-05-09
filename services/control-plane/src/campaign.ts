import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  attachCampaignLeadLists,
  deleteCampaignFromDb,
  getCampaignFromDb,
  getCampaignLeadListIds,
  getLeadListFromDb,
  getRoutePlanFromDb,
  insertCampaign,
  listCampaignsFromDb,
  listCampaignsUsingLeadList,
  listCampaignsUsingRoutePlan,
  updateCampaignStatusInDb,
  type CampaignRecord,
} from './db';

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
    lead_list_ids: z
      .array(z.string().uuid())
      .min(1, 'attach at least one lead list.'),
    base_ratio: z.number().min(0.5).max(10).default(1.0),
    call_window_start: TimeOfDay.optional(),
    call_window_end: TimeOfDay.optional(),
    max_abandon_pct: z.number().min(0).max(100).default(3.0),
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
  });
  attachCampaignLeadLists(id, input.lead_list_ids);
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

export type { CampaignRecord } from './db';
