import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  deleteRoutePlanFromDb,
  getCarrierFromDb,
  getCidGroupFromDb,
  getRoutePlanFromDb,
  insertRoutePlan,
  listRoutePlansFromDb,
  listRoutePlansUsingCarrier,
  updateRoutePlanFields,
  type RoutePlanRecord,
} from './db';

// Iter 72 — 'groups' picks CIDs from one or more attached cid_groups.
// Each group has its own per-call strategy (rotate / random /
// sticky_by_area). Multiple groups are rotated across at the plan
// level, then the chosen group's own strategy runs.
export const CidStrategySchema = z.enum([
  'passthrough',
  'single',
  'rotate',
  'groups',
]);
export type CidStrategy = z.infer<typeof CidStrategySchema>;

const PHONE_NUMBER_RE = /^\+?[0-9]{4,20}$/;

export const RoutePlanInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.'),
    description: z.string().max(500).optional(),
    primary_carrier_id: z.string().uuid('primary_carrier_id must be a UUID.'),
    failover_carrier_ids: z.array(z.string().uuid()).default([]),
    cid_strategy: CidStrategySchema.default('passthrough'),
    cid_single: z.string().optional(),
    cid_pool: z.array(z.string()).default([]),
    /** Iter 72 — attached CID group ids (only consulted when
     * cid_strategy === 'groups'). */
    cid_group_ids: z.array(z.string().uuid()).default([]),
    transform_strip_prefix: z.string().max(20).optional(),
    transform_add_prefix: z.string().max(20).optional(),
    enabled: z.boolean().default(true),
  })
  .refine(
    (d) =>
      d.cid_strategy !== 'single' ||
      (!!d.cid_single && PHONE_NUMBER_RE.test(d.cid_single)),
    {
      message:
        'cid_single must be a phone number (digits, optional +) for single strategy.',
      path: ['cid_single'],
    },
  )
  .refine(
    (d) =>
      d.cid_strategy !== 'rotate' ||
      (d.cid_pool.length > 0 &&
        d.cid_pool.every((n) => PHONE_NUMBER_RE.test(n))),
    {
      message:
        'cid_pool must contain at least one valid phone number for rotate strategy.',
      path: ['cid_pool'],
    },
  )
  .refine(
    (d) => d.cid_strategy !== 'groups' || d.cid_group_ids.length > 0,
    {
      message:
        'Pick at least one CID group when strategy is "groups".',
      path: ['cid_group_ids'],
    },
  )
  .refine(
    (d) => !d.failover_carrier_ids.includes(d.primary_carrier_id),
    {
      message: 'primary carrier cannot also be a failover.',
      path: ['failover_carrier_ids'],
    },
  );
export type RoutePlanInput = z.infer<typeof RoutePlanInputSchema>;

export interface CreateRoutePlanResult {
  id: string;
}

export function createRoutePlan(input: RoutePlanInput): CreateRoutePlanResult {
  // Validate that primary carrier exists.
  const primary = getCarrierFromDb(input.primary_carrier_id);
  if (!primary) {
    throw new Error(`Primary carrier ${input.primary_carrier_id} not found.`);
  }
  // Validate that failover carriers exist.
  for (const fid of input.failover_carrier_ids) {
    if (!getCarrierFromDb(fid)) {
      throw new Error(`Failover carrier ${fid} not found.`);
    }
  }

  // Iter 72 — validate that every referenced CID group exists.
  for (const gid of input.cid_group_ids) {
    if (!getCidGroupFromDb(gid)) {
      throw new Error(`CID group ${gid} not found.`);
    }
  }

  const id = randomUUID();
  insertRoutePlan({
    id,
    name: input.name,
    description: input.description ?? null,
    primary_carrier_id: input.primary_carrier_id,
    failover_carrier_ids_json: JSON.stringify(input.failover_carrier_ids),
    cid_strategy: input.cid_strategy,
    cid_single: input.cid_single ?? null,
    cid_pool_json: JSON.stringify(input.cid_pool),
    cid_group_ids_json: JSON.stringify(input.cid_group_ids),
    transform_strip_prefix: input.transform_strip_prefix ?? null,
    transform_add_prefix: input.transform_add_prefix ?? null,
    enabled: input.enabled,
  });
  return { id };
}

export function listRoutePlans(): RoutePlanRecord[] {
  return listRoutePlansFromDb();
}

export function getRoutePlan(id: string): RoutePlanRecord | undefined {
  return getRoutePlanFromDb(id);
}

export function deleteRoutePlan(id: string): boolean {
  return deleteRoutePlanFromDb(id);
}

export function getRoutePlansForCarrier(carrierId: string): RoutePlanRecord[] {
  return listRoutePlansUsingCarrier(carrierId);
}

// JSON parse helpers — DB stores arrays as JSON-encoded TEXT.

export function parseFailoverIds(plan: RoutePlanRecord): string[] {
  try {
    const parsed = JSON.parse(plan.failover_carrier_ids_json);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function parseCidPool(plan: RoutePlanRecord): string[] {
  try {
    const parsed = JSON.parse(plan.cid_pool_json);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/** Iter 72 — attached CID group IDs on the plan. */
export function parseCidGroupIds(plan: RoutePlanRecord): string[] {
  try {
    const parsed = JSON.parse(plan.cid_group_ids_json ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string')
      : [];
  } catch {
    return [];
  }
}

// Iter 14: edit. primary_carrier_id intentionally NOT mutable here — a
// route plan's primary carrier is the load-bearing reference; changing
// it should be a delete + recreate flow. Failovers, CID strategy,
// transforms, and enabled flag are all editable.
export const RoutePlanUpdateInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.')
      .optional(),
    description: z.string().max(500).optional(),
    failover_carrier_ids: z.array(z.string().uuid()).optional(),
    cid_strategy: CidStrategySchema.optional(),
    cid_single: z.string().optional(),
    cid_pool: z.array(z.string()).optional(),
    cid_group_ids: z.array(z.string().uuid()).optional(),
    transform_strip_prefix: z.string().max(20).optional(),
    transform_add_prefix: z.string().max(20).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (d) => {
      if (d.cid_strategy !== 'single') return true;
      if (d.cid_single === undefined) return true; // not touched
      return !!d.cid_single && PHONE_NUMBER_RE.test(d.cid_single);
    },
    {
      message: 'cid_single must be a valid phone number.',
      path: ['cid_single'],
    },
  )
  .refine(
    (d) => {
      if (d.cid_strategy !== 'rotate') return true;
      if (d.cid_pool === undefined) return true;
      return d.cid_pool.length > 0 && d.cid_pool.every((n) => PHONE_NUMBER_RE.test(n));
    },
    {
      message: 'cid_pool must contain at least one valid phone number.',
      path: ['cid_pool'],
    },
  );
export type RoutePlanUpdateInput = z.infer<typeof RoutePlanUpdateInputSchema>;

export function updateRoutePlan(
  id: string,
  input: RoutePlanUpdateInput,
): boolean {
  const existing = getRoutePlanFromDb(id);
  if (!existing) throw new Error(`Route plan ${id} not found`);

  if (input.failover_carrier_ids !== undefined) {
    if (input.failover_carrier_ids.includes(existing.primary_carrier_id)) {
      throw new Error('primary carrier cannot also be a failover.');
    }
    for (const fid of input.failover_carrier_ids) {
      if (!getCarrierFromDb(fid)) {
        throw new Error(`Failover carrier ${fid} not found.`);
      }
    }
  }

  const updates: Parameters<typeof updateRoutePlanFields>[1] = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) {
    updates.description = input.description || null;
  }
  if (input.failover_carrier_ids !== undefined) {
    updates.failover_carrier_ids_json = JSON.stringify(
      input.failover_carrier_ids,
    );
  }
  if (input.cid_strategy !== undefined) {
    updates.cid_strategy = input.cid_strategy;
    // When switching strategy, clear stale data from other strategies.
    if (input.cid_strategy === 'passthrough') {
      updates.cid_single = null;
      updates.cid_pool_json = '[]';
      updates.cid_group_ids_json = '[]';
    }
  }
  if (input.cid_single !== undefined) {
    updates.cid_single = input.cid_single || null;
  }
  if (input.cid_pool !== undefined) {
    updates.cid_pool_json = JSON.stringify(input.cid_pool);
  }
  if (input.cid_group_ids !== undefined) {
    // Iter 72 — validate referenced groups exist before persisting.
    for (const gid of input.cid_group_ids) {
      if (!getCidGroupFromDb(gid)) {
        throw new Error(`CID group ${gid} not found.`);
      }
    }
    updates.cid_group_ids_json = JSON.stringify(input.cid_group_ids);
  }
  if (input.transform_strip_prefix !== undefined) {
    updates.transform_strip_prefix = input.transform_strip_prefix || null;
  }
  if (input.transform_add_prefix !== undefined) {
    updates.transform_add_prefix = input.transform_add_prefix || null;
  }
  if (input.enabled !== undefined) updates.enabled = input.enabled;
  return updateRoutePlanFields(id, updates);
}

export type { RoutePlanRecord } from './db';
