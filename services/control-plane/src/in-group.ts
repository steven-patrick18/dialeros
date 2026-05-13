import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  attachDidToInGroup,
  deleteInGroupFromDb,
  detachDidFromInGroup,
  findDidOwner,
  getInGroupFromDb,
  insertInGroup,
  listDidsForInGroup,
  listInGroupsFromDb,
  updateInGroupFields,
  type InGroupRecord,
} from './db';
import { normalizePhone } from './lead';

export const InGroupTypeSchema = z.enum([
  'inbound_queue',
  'transfer_target',
  'both',
]);
export type InGroupType = z.infer<typeof InGroupTypeSchema>;

export const WhitelistModeSchema = z.enum([
  'none',
  'static',
  'cluster_wide_leads',
]);
export type WhitelistMode = z.infer<typeof WhitelistModeSchema>;

export const RoutingStrategySchema = z.enum([
  'ring_all',
  'longest_idle',
  'random',
]);
export type RoutingStrategy = z.infer<typeof RoutingStrategySchema>;

export const OffListActionSchema = z.enum(['reject', 'fallback_announcement']);
export type OffListAction = z.infer<typeof OffListActionSchema>;

export const InGroupInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.'),
    description: z.string().max(500).optional(),
    type: InGroupTypeSchema.default('inbound_queue'),
    whitelist_mode: WhitelistModeSchema.default('none'),
    whitelist_static: z.array(z.string()).default([]),
    routing_strategy: RoutingStrategySchema.default('ring_all'),
    max_wait_seconds: z.number().int().min(5).max(3600).default(60),
    wrap_up_seconds: z.number().int().min(0).max(600).default(10),
    off_list_action: OffListActionSchema.default('reject'),
    enabled: z.boolean().default(true),
  })
  .refine(
    (d) => d.whitelist_mode !== 'static' || d.whitelist_static.length > 0,
    {
      message:
        'whitelist_static must contain at least one phone number when mode is static.',
      path: ['whitelist_static'],
    },
  );
export type InGroupInput = z.infer<typeof InGroupInputSchema>;

export interface CreateInGroupResult {
  id: string;
}

export function createInGroup(input: InGroupInput): CreateInGroupResult {
  // Validate static whitelist phones if used.
  let normalizedStatic: string[] = [];
  if (input.whitelist_mode === 'static') {
    for (const raw of input.whitelist_static) {
      const n = normalizePhone(raw);
      if (!n) {
        throw new Error(`Invalid phone in whitelist: ${raw}`);
      }
      normalizedStatic.push(n);
    }
  }

  const id = randomUUID();
  insertInGroup({
    id,
    name: input.name,
    description: input.description ?? null,
    type: input.type,
    whitelist_mode: input.whitelist_mode,
    whitelist_static_json: JSON.stringify(normalizedStatic),
    routing_strategy: input.routing_strategy,
    max_wait_seconds: input.max_wait_seconds,
    wrap_up_seconds: input.wrap_up_seconds,
    off_list_action: input.off_list_action,
    enabled: input.enabled,
  });
  return { id };
}

export function listInGroups(): InGroupRecord[] {
  return listInGroupsFromDb();
}

export function getInGroup(id: string): InGroupRecord | undefined {
  return getInGroupFromDb(id);
}

export function deleteInGroup(id: string): boolean {
  return deleteInGroupFromDb(id);
}

export function getInGroupDids(id: string): string[] {
  return listDidsForInGroup(id);
}

export function parseStaticWhitelist(rec: InGroupRecord): string[] {
  try {
    const parsed = JSON.parse(rec.whitelist_static_json);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export const DidInputSchema = z.object({
  did: z.string().min(1),
});
export type DidInput = z.infer<typeof DidInputSchema>;

export type AddDidResult =
  | { ok: true; did: string }
  | { ok: false; error: 'invalid_format' | 'already_attached'; existingOwner?: string };

export function addDidToInGroup(
  inGroupId: string,
  rawDid: string,
): AddDidResult {
  const normalized = normalizePhone(rawDid);
  if (!normalized) {
    return { ok: false, error: 'invalid_format' };
  }
  const existingOwner = findDidOwner(normalized);
  if (existingOwner) {
    return {
      ok: false,
      error: 'already_attached',
      existingOwner,
    };
  }
  attachDidToInGroup(inGroupId, normalized);
  return { ok: true, did: normalized };
}

export function removeDidFromInGroup(
  inGroupId: string,
  did: string,
): boolean {
  return detachDidFromInGroup(inGroupId, did);
}

// Iter 14: edit. All fields editable. DIDs are managed separately
// via the existing /api/in-groups/[id]/dids endpoint, not here.
export const InGroupUpdateInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.')
      .optional(),
    description: z.string().max(500).optional(),
    type: InGroupTypeSchema.optional(),
    whitelist_mode: WhitelistModeSchema.optional(),
    whitelist_static: z.array(z.string()).optional(),
    routing_strategy: RoutingStrategySchema.optional(),
    max_wait_seconds: z.number().int().min(5).max(3600).optional(),
    wrap_up_seconds: z.number().int().min(0).max(600).optional(),
    off_list_action: OffListActionSchema.optional(),
    enabled: z.boolean().optional(),
    // Iter 153/155 — call menu wiring. Each accepts a UUID or empty
    // string (treated as "clear the binding"); validation that the
    // ID exists is left to the iter-152 dialplan generator which
    // will simply emit `transfer ${empty}` if the menu was deleted.
    entry_call_menu_id: z
      .string()
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
    overflow_call_menu_id: z
      .string()
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
    after_hours_call_menu_id: z
      .string()
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
  })
  .refine(
    (d) => {
      if (d.whitelist_mode !== 'static') return true;
      if (d.whitelist_static === undefined) return true; // not touched
      return d.whitelist_static.length > 0;
    },
    {
      message: 'whitelist_static must contain at least one phone when mode is static.',
      path: ['whitelist_static'],
    },
  );
export type InGroupUpdateInput = z.infer<typeof InGroupUpdateInputSchema>;

export function updateInGroup(
  id: string,
  input: InGroupUpdateInput,
): boolean {
  if (!getInGroupFromDb(id)) {
    throw new Error(`In-group ${id} not found`);
  }

  // If switching TO static mode, validate the new whitelist phones now.
  let normalizedStatic: string[] | undefined;
  if (input.whitelist_static !== undefined) {
    normalizedStatic = [];
    for (const raw of input.whitelist_static) {
      const n = normalizePhone(raw);
      if (!n) {
        throw new Error(`Invalid phone in whitelist: ${raw}`);
      }
      normalizedStatic.push(n);
    }
  }

  const updates: Parameters<typeof updateInGroupFields>[1] = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) {
    updates.description = input.description || null;
  }
  if (input.type !== undefined) updates.type = input.type;
  if (input.whitelist_mode !== undefined) {
    updates.whitelist_mode = input.whitelist_mode;
    // Switching off 'static' clears the static list to avoid stale data.
    if (input.whitelist_mode !== 'static') {
      updates.whitelist_static_json = '[]';
    }
  }
  if (normalizedStatic !== undefined) {
    updates.whitelist_static_json = JSON.stringify(normalizedStatic);
  }
  if (input.routing_strategy !== undefined) {
    updates.routing_strategy = input.routing_strategy;
  }
  if (input.max_wait_seconds !== undefined) {
    updates.max_wait_seconds = input.max_wait_seconds;
  }
  if (input.wrap_up_seconds !== undefined) {
    updates.wrap_up_seconds = input.wrap_up_seconds;
  }
  if (input.off_list_action !== undefined) {
    updates.off_list_action = input.off_list_action;
  }
  if (input.enabled !== undefined) updates.enabled = input.enabled;
  if (input.entry_call_menu_id !== undefined) {
    updates.entry_call_menu_id = input.entry_call_menu_id;
  }
  if (input.overflow_call_menu_id !== undefined) {
    updates.overflow_call_menu_id = input.overflow_call_menu_id;
  }
  if (input.after_hours_call_menu_id !== undefined) {
    updates.after_hours_call_menu_id = input.after_hours_call_menu_id;
  }
  return updateInGroupFields(id, updates);
}

export type { InGroupRecord } from './db';
