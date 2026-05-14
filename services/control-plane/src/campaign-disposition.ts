/* Iter 174 — Per-campaign disposition palettes.
 *
 * The iter-25 DispositionSchema is a closed enum: SALE, DNC,
 * NO_INTEREST, WRONG_NUMBER, BAD_NUMBER, ANSWERING_MACHINE,
 * CALLBACK, VOICEMAIL_DROPPED, SURVEYED. Different campaigns
 * need different codes — debt collectors want PROMISE_TO_PAY,
 * surveys don't need SALE, etc. Iter 174 ships a per-campaign
 * palette: when set, the agent UI shows those codes instead of
 * the hardcoded list; disposeAgentIntent validates against the
 * palette.
 *
 * Fall-through: campaigns without a palette continue to use the
 * iter-25 hardcoded list — existing deployments behave
 * unchanged until an admin opens /campaigns/<id>/dispositions
 * and defines one.
 */
import { z } from 'zod';
import {
  deleteCampaignDispositionsForCampaign,
  insertCampaignDispositionRows,
  listCampaignDispositionsFromDb,
  type CampaignDispositionRecord,
} from './db';

// Lead status targets — the same statuses leads.status accepts.
// Defined here so the palette form can show a closed dropdown.
export const LEAD_STATUS_TARGETS = [
  'NEW',
  'CALLED_NO_ANSWER',
  'CALLBACK_SCHEDULED',
  'CONVERTED',
  'DEAD',
  'DNC',
  'DNC_TEMP',
  'BAD_NUMBER',
  'VM_PLAYED',
  'SURVEYED',
] as const;
export const LeadStatusTargetSchema = z.enum(LEAD_STATUS_TARGETS);
export type LeadStatusTarget = z.infer<typeof LeadStatusTargetSchema>;

export const CampaignDispositionInputSchema = z.object({
  // Codes follow ViciDial convention: uppercase letters / digits /
  // dashes / underscores, up to 32 chars. Tight enough to avoid
  // weird-character bugs in CSV exports + URL params.
  code: z
    .string()
    .min(1)
    .max(32)
    .regex(
      /^[A-Z0-9_-]+$/,
      'Disposition code must be UPPERCASE letters, digits, _ or -',
    ),
  label: z.string().min(1).max(80),
  lead_status_target: LeadStatusTargetSchema,
  is_callback: z.boolean().default(false),
  ordering: z.number().int().min(0).max(99).default(0),
  is_active: z.boolean().default(true),
});
export type CampaignDispositionInput = z.infer<
  typeof CampaignDispositionInputSchema
>;

export const CampaignDispositionPaletteSchema = z
  .array(CampaignDispositionInputSchema)
  .max(50)
  .refine(
    (palette) => {
      const seen = new Set<string>();
      for (const d of palette) {
        if (seen.has(d.code)) return false;
        seen.add(d.code);
      }
      return true;
    },
    { message: 'Disposition codes must be unique within a campaign.' },
  );
export type CampaignDispositionPalette = z.infer<
  typeof CampaignDispositionPaletteSchema
>;

/** Replace the entire palette for a campaign in one transaction.
 * Identical pattern to iter-149 call menu options + iter-157
 * survey questions: the admin UI saves the whole list, server
 * deletes-and-inserts so concurrent edits land atomically. */
export function saveCampaignDispositionPalette(
  campaignId: string,
  palette: CampaignDispositionPalette,
): { count: number } {
  deleteCampaignDispositionsForCampaign(campaignId);
  if (palette.length === 0) return { count: 0 };
  insertCampaignDispositionRows(
    campaignId,
    palette.map((d, idx) => ({
      code: d.code,
      label: d.label,
      lead_status_target: d.lead_status_target,
      is_callback: d.is_callback,
      ordering: d.ordering || idx,
      is_active: d.is_active,
    })),
  );
  return { count: palette.length };
}

export function getCampaignDispositionPalette(
  campaignId: string,
): CampaignDispositionRecord[] {
  return listCampaignDispositionsFromDb(campaignId);
}

/** True when the campaign has its own (non-empty) palette
 *  defined; false means the agent UI falls back to the iter-25
 *  hardcoded list. */
export function hasCustomDispositionPalette(campaignId: string): boolean {
  return listCampaignDispositionsFromDb(campaignId).length > 0;
}

/** Look up the lead-status target for a code in a campaign's
 *  palette. Returns undefined when the code isn't in the palette
 *  (caller should then fall back to the hardcoded mapping). */
export function resolvePaletteLeadStatus(
  campaignId: string,
  code: string,
): string | undefined {
  const rows = listCampaignDispositionsFromDb(campaignId);
  const hit = rows.find((r) => r.code === code && r.is_active === 1);
  return hit?.lead_status_target;
}
