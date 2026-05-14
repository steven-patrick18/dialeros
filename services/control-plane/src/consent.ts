/* Iter 168 — Consent records domain module.
 *
 * Searchable "they said yes" log. When a lead grants express
 * consent (written, oral, or prior business relationship), the
 * operator records it here. Pulled out of audit_events into its
 * own table because:
 *   - regulators ask for consent records as a separate artifact
 *   - revocation is a first-class state with its own timestamp
 *   - search by phone needs an index, audit_events doesn't have one
 *   - the source_ref column carries the evidence pointer (web
 *     form URL, signed PDF filename, recording ID) that auditors
 *     ask to inspect
 *
 * Iter 168 ships the model + admin CRUD. Iter 169+ could wire
 * hasActiveConsent() into the pacer as a hard dial-time gate
 * — deferred because operators have wildly different consent
 * regimes (some never need express consent; B2B exemption etc.)
 * and a global gate would break those flows.
 */
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  deleteConsentRecordFromDb,
  getConsentRecordFromDb,
  hasActiveConsentForPhone,
  insertConsentRecord,
  listConsentRecordsFromDb,
  searchConsentRecords,
  updateConsentRecordFields,
  type ConsentRecord,
} from './db';
import { normalizePhone } from './lead';

export const ConsentTypeSchema = z.enum([
  'express_written',
  'express_oral',
  'prior_business',
  'web_form',
  'other',
]);
export type ConsentType = z.infer<typeof ConsentTypeSchema>;

export const ConsentSourceSchema = z.enum([
  'web_form',
  'csv_import',
  'manual',
  'recording',
  'pdf_signature',
  'other',
]);
export type ConsentSource = z.infer<typeof ConsentSourceSchema>;

export const ConsentRecordInputSchema = z.object({
  phone: z.string().min(4).max(40),
  consent_type: ConsentTypeSchema,
  source: ConsentSourceSchema,
  source_ref: z.string().max(500).default(''),
  granted_at: z
    .string()
    .datetime()
    .optional()
    .or(z.literal('').transform(() => null)),
  notes: z.string().max(2000).default(''),
  lead_id: z
    .string()
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
});
export type ConsentRecordInput = z.infer<typeof ConsentRecordInputSchema>;

export const ConsentRevokeInputSchema = z.object({
  reason: z.string().max(500).default(''),
});
export type ConsentRevokeInput = z.infer<typeof ConsentRevokeInputSchema>;

export function createConsentRecord(
  input: ConsentRecordInput,
  ctx: { grantedByUserId: string | null },
): { id: string } | { error: string } {
  const norm = normalizePhone(input.phone);
  if (!norm) return { error: 'Invalid phone format.' };
  const id = randomUUID();
  insertConsentRecord({
    id,
    phone: norm,
    consent_type: input.consent_type,
    source: input.source,
    source_ref: input.source_ref || null,
    granted_at: input.granted_at ?? new Date().toISOString(),
    revoked_at: null,
    notes: input.notes || null,
    granted_by_user_id: ctx.grantedByUserId,
    lead_id: input.lead_id ?? null,
  });
  return { id };
}

export function listConsentRecords(filters?: {
  active_only?: boolean;
  phone?: string;
  limit?: number;
}): ConsentRecord[] {
  const limit = Math.max(1, Math.min(500, filters?.limit ?? 200));
  if (filters?.phone) {
    const norm = normalizePhone(filters.phone);
    if (!norm) return [];
    return searchConsentRecords(norm, filters.active_only ?? false, limit);
  }
  return listConsentRecordsFromDb(filters?.active_only ?? false, limit);
}

export function getConsentRecord(id: string): ConsentRecord | undefined {
  return getConsentRecordFromDb(id);
}

export function revokeConsentRecord(
  id: string,
  input: ConsentRevokeInput,
): boolean {
  const existing = getConsentRecordFromDb(id);
  if (!existing) return false;
  if (existing.revoked_at) return true; // already revoked — idempotent
  return updateConsentRecordFields(id, {
    revoked_at: new Date().toISOString(),
    notes: input.reason
      ? `${existing.notes ?? ''}${existing.notes ? '\n' : ''}REVOKED: ${input.reason}`
      : existing.notes,
  });
}

export function deleteConsentRecord(id: string): boolean {
  return deleteConsentRecordFromDb(id);
}

export function hasActiveConsent(phone: string): boolean {
  const norm = normalizePhone(phone);
  if (!norm) return false;
  return hasActiveConsentForPhone(norm);
}
