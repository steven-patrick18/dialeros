import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  deletePhone,
  getNodeFromDb,
  getPhoneById,
  getPhoneByExtension,
  getPrimaryPhoneForUser,
  insertPhone,
  listPhonesForUser,
  nodeHasRole,
  unsetOtherPrimaryPhones,
  updatePhoneFields,
  type PhoneRecord,
} from './db';

// Iter 40 — phones owned by a user. Each user can have multiple phones
// (e.g. desk + softphone), one marked is_primary. The agent's browser
// softphone registers as the primary; the pacer bridges live calls to
// `user/<primary_extension>`. When a user has no phones, the system
// falls back to the iter-35 hash-derived extension (1000-1019) so the
// transition is non-destructive.

const ExtensionSchema = z
  .string()
  .min(2)
  .max(16)
  .regex(/^[0-9*#]+$/, 'Digits, * and # only.');

const PasswordSchema = z.string().min(4).max(64);

export const PhoneInputSchema = z.object({
  extension: ExtensionSchema,
  password: PasswordSchema,
  label: z.string().max(120).optional().or(z.literal('').transform(() => undefined)),
  protocol: z.enum(['sip', 'iax2']).default('sip'),
  is_primary: z.boolean().default(true),
  // Iter 62 — which telephony node hosts this phone. Optional;
  // null means "let softphone-config pick the only telephony node
  // it can find", which is the single-box default. When a cluster
  // has multiple telephony nodes the admin pins each phone here.
  telephony_node_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
});
export type PhoneInput = z.infer<typeof PhoneInputSchema>;

export const PhoneUpdateInputSchema = PhoneInputSchema.partial();
export type PhoneUpdateInput = z.infer<typeof PhoneUpdateInputSchema>;

export interface CreatePhoneResult {
  id: string;
}

export function createPhone(
  userId: string,
  input: PhoneInput,
): CreatePhoneResult | { error: string } {
  if (getPhoneByExtension(input.extension)) {
    return { error: `Extension ${input.extension} is already in use.` };
  }
  if (input.telephony_node_id) {
    const node = getNodeFromDb(input.telephony_node_id);
    if (!node) return { error: `Node ${input.telephony_node_id} not found.` };
    if (!nodeHasRole(node, 'telephony')) {
      return { error: 'Bound node must include the telephony role.' };
    }
  }
  const id = randomUUID();
  // First phone for a user is always primary regardless of input.
  const existing = listPhonesForUser(userId);
  const isPrimary = existing.length === 0 ? true : input.is_primary;
  insertPhone({
    id,
    user_id: userId,
    extension: input.extension,
    password: input.password,
    label: input.label ?? null,
    protocol: input.protocol,
    is_primary: isPrimary,
    telephony_node_id: input.telephony_node_id ?? null,
  });
  if (isPrimary) {
    unsetOtherPrimaryPhones(userId, id);
  }
  return { id };
}

export function updatePhone(
  id: string,
  input: PhoneUpdateInput,
): { changed: boolean } | { error: string } {
  const existing = getPhoneById(id);
  if (!existing) return { error: 'not found' };

  if (input.extension && input.extension !== existing.extension) {
    const clash = getPhoneByExtension(input.extension);
    if (clash && clash.id !== id) {
      return { error: `Extension ${input.extension} is already in use.` };
    }
  }
  if (input.telephony_node_id) {
    const node = getNodeFromDb(input.telephony_node_id);
    if (!node) return { error: `Node ${input.telephony_node_id} not found.` };
    if (!nodeHasRole(node, 'telephony')) {
      return { error: 'Bound node must include the telephony role.' };
    }
  }

  const updates: Parameters<typeof updatePhoneFields>[1] = {};
  if (input.extension !== undefined) updates.extension = input.extension;
  if (input.password !== undefined) updates.password = input.password;
  if (input.label !== undefined) updates.label = input.label || null;
  if (input.protocol !== undefined) updates.protocol = input.protocol;
  if (input.is_primary !== undefined) updates.is_primary = input.is_primary;
  if (input.telephony_node_id !== undefined) {
    updates.telephony_node_id = input.telephony_node_id ?? null;
  }

  const changed = updatePhoneFields(id, updates);
  if (changed && input.is_primary === true) {
    unsetOtherPrimaryPhones(existing.user_id, id);
  }
  return { changed };
}

export function removePhone(id: string): { ok: boolean } {
  return { ok: deletePhone(id) };
}

export function listPhones(userId: string): PhoneRecord[] {
  return listPhonesForUser(userId);
}

export function getPhone(id: string): PhoneRecord | undefined {
  return getPhoneById(id);
}

export function getPrimaryPhone(userId: string): PhoneRecord | undefined {
  return getPrimaryPhoneForUser(userId);
}

export type { PhoneRecord };
