import { randomUUID } from 'node:crypto';
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

export type { InGroupRecord } from './db';
