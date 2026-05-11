import { z } from 'zod';
import {
  countDncPhones,
  deleteDncPhone,
  insertDncPhone,
  isDncPhone,
  listDncPhonesFromDb,
  type DncPhoneRecord,
} from './db';
import { normalizePhone } from './lead';
import { appendAudit } from './audit';

// Iter 64 — Do Not Call list. Numbers here are blocked at every
// originate path: pacer, agent manual dial, admin test call. Phone
// is normalised (digits, leading + stripped to canonical) before
// store + lookup so an admin can paste a CSV with parens / dashes
// / leading-1 and the rows match.

export const DncInputSchema = z.object({
  phone: z.string().min(4).max(40),
  reason: z.string().max(200).optional(),
});
export type DncInput = z.infer<typeof DncInputSchema>;

export function addDnc(
  input: DncInput,
  ctx: { actorUserId: string | null; actorIp: string | null },
): { phone: string } | { error: string } {
  const norm = normalizePhone(input.phone);
  if (!norm) return { error: 'Invalid phone format.' };
  insertDncPhone({
    phone: norm,
    reason: input.reason ?? null,
    added_by_user_id: ctx.actorUserId,
  });
  appendAudit({
    actorUserId: ctx.actorUserId,
    actorIp: ctx.actorIp,
    action: 'dnc.added',
    targetType: 'dnc_phone',
    targetId: norm,
    payload: { reason: input.reason ?? null },
  });
  return { phone: norm };
}

/** Bulk-add normalised phones; returns { added, skipped } counts. */
export function bulkAddDnc(
  phones: string[],
  ctx: { actorUserId: string | null; actorIp: string | null; reason?: string },
): { added: number; skipped: number } {
  let added = 0;
  let skipped = 0;
  for (const raw of phones) {
    const norm = normalizePhone(raw);
    if (!norm) {
      skipped++;
      continue;
    }
    insertDncPhone({
      phone: norm,
      reason: ctx.reason ?? null,
      added_by_user_id: ctx.actorUserId,
    });
    added++;
  }
  if (added > 0) {
    appendAudit({
      actorUserId: ctx.actorUserId,
      actorIp: ctx.actorIp,
      action: 'dnc.bulk_added',
      targetType: 'dnc_phone',
      targetId: null,
      payload: { added, skipped, reason: ctx.reason ?? null },
    });
  }
  return { added, skipped };
}

export function removeDnc(
  phone: string,
  ctx: { actorUserId: string | null; actorIp: string | null },
): boolean {
  const norm = normalizePhone(phone) ?? phone;
  const ok = deleteDncPhone(norm);
  if (ok) {
    appendAudit({
      actorUserId: ctx.actorUserId,
      actorIp: ctx.actorIp,
      action: 'dnc.removed',
      targetType: 'dnc_phone',
      targetId: norm,
      payload: {},
    });
  }
  return ok;
}

export function isDnc(phone: string): boolean {
  const norm = normalizePhone(phone);
  if (!norm) return false;
  return isDncPhone(norm);
}

export function listDnc(limit = 500, offset = 0): DncPhoneRecord[] {
  return listDncPhonesFromDb(limit, offset);
}

export function countDnc(): number {
  return countDncPhones();
}

export type { DncPhoneRecord };
