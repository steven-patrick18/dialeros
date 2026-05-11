import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  deleteRoutePlanFromDb,
  getCarrierFromDb,
  getCidGroupFromDb,
  getRoutePlanFromDb,
  insertRoutePlan,
  listCarriersForRoutePlanFromDb,
  listRoutePlansFromDb,
  listRoutePlansUsingCarrier,
  replaceRoutePlanCarriers,
  updateRoutePlanFields,
  type RoutePlanCarrierRecord,
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

// Iter 74 — schema for the multi-carrier set. Same priority across
// multiple rows means round-robin within that tier (so [1, 1] = 50/50);
// lower priority wins first (1 dials before 2). ports is the
// per-(plan, carrier) concurrent-call cap enforced at originate.
export const PlanCarrierRowSchema = z.object({
  carrier_id: z.string().uuid(),
  priority: z.number().int().min(1).max(99).default(1),
  ports: z.number().int().min(1).max(9999).default(30),
});
export type PlanCarrierRow = z.infer<typeof PlanCarrierRowSchema>;

export const RoutePlanInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.'),
    description: z.string().max(500).optional(),
    // Iter 74 — `carriers` is the new source of truth. The legacy
    // primary_carrier_id + failover_carrier_ids fields stay accepted
    // (and derived from carriers if omitted) so older callers don't
    // break.
    carriers: z.array(PlanCarrierRowSchema).default([]),
    primary_carrier_id: z
      .string()
      .uuid('primary_carrier_id must be a UUID.')
      .optional(),
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
    (d) =>
      d.primary_carrier_id === undefined ||
      !d.failover_carrier_ids.includes(d.primary_carrier_id),
    {
      message: 'primary carrier cannot also be a failover.',
      path: ['failover_carrier_ids'],
    },
  )
  // Iter 74 — caller must specify carriers somehow. Either the new
  // `carriers` array OR the legacy primary_carrier_id (+ optional
  // failovers). Empty `carriers` AND missing primary = reject.
  .refine((d) => d.carriers.length > 0 || !!d.primary_carrier_id, {
    message:
      'At least one carrier is required (set `carriers` or `primary_carrier_id`).',
    path: ['carriers'],
  })
  // Iter 74 — no duplicate carrier_id inside `carriers`.
  .refine(
    (d) => {
      const seen = new Set<string>();
      for (const r of d.carriers) {
        if (seen.has(r.carrier_id)) return false;
        seen.add(r.carrier_id);
      }
      return true;
    },
    {
      message: 'Duplicate carrier in `carriers` list.',
      path: ['carriers'],
    },
  );
export type RoutePlanInput = z.infer<typeof RoutePlanInputSchema>;

export interface CreateRoutePlanResult {
  id: string;
}

export function createRoutePlan(input: RoutePlanInput): CreateRoutePlanResult {
  // Iter 74 — resolve the carrier set. Prefer the new `carriers`
  // array; fall back to (primary_carrier_id + failover_carrier_ids)
  // when callers haven't been updated. The two are equivalent —
  // priority 1 = primary, 2..N = failovers in order.
  const carriers: PlanCarrierRow[] =
    input.carriers.length > 0
      ? input.carriers
      : buildLegacyCarrierRows(
          input.primary_carrier_id!,
          input.failover_carrier_ids,
        );

  // Validate every carrier exists.
  for (const r of carriers) {
    if (!getCarrierFromDb(r.carrier_id)) {
      throw new Error(`Carrier ${r.carrier_id} not found.`);
    }
  }

  // Iter 72 — validate that every referenced CID group exists.
  for (const gid of input.cid_group_ids) {
    if (!getCidGroupFromDb(gid)) {
      throw new Error(`CID group ${gid} not found.`);
    }
  }

  // Derived legacy columns: lowest-priority carrier is "primary",
  // remaining ones (ordered by priority asc) are failovers.
  const sorted = [...carriers].sort((a, b) => a.priority - b.priority);
  const primaryCarrierId = sorted[0]!.carrier_id;
  const failoverIds = sorted.slice(1).map((r) => r.carrier_id);

  const id = randomUUID();
  insertRoutePlan({
    id,
    name: input.name,
    description: input.description ?? null,
    primary_carrier_id: primaryCarrierId,
    failover_carrier_ids_json: JSON.stringify(failoverIds),
    cid_strategy: input.cid_strategy,
    cid_single: input.cid_single ?? null,
    cid_pool_json: JSON.stringify(input.cid_pool),
    cid_group_ids_json: JSON.stringify(input.cid_group_ids),
    transform_strip_prefix: input.transform_strip_prefix ?? null,
    transform_add_prefix: input.transform_add_prefix ?? null,
    enabled: input.enabled,
  });
  // Write the join table — the source of truth for the pacer.
  replaceRoutePlanCarriers(id, carriers);
  return { id };
}

function buildLegacyCarrierRows(
  primary: string,
  failovers: string[],
): PlanCarrierRow[] {
  const out: PlanCarrierRow[] = [
    { carrier_id: primary, priority: 1, ports: 30 },
  ];
  failovers.forEach((cid, idx) => {
    out.push({ carrier_id: cid, priority: 2 + idx, ports: 30 });
  });
  return out;
}

/** Iter 74 — list the carriers attached to a route plan, ordered by
 * priority asc then created_at asc. Public-API consumers and the
 * UI both use this. */
export function listCarriersForRoutePlan(
  planId: string,
): RoutePlanCarrierRecord[] {
  return listCarriersForRoutePlanFromDb(planId);
}

/** Iter 74 — replace the full carrier set on a plan. Validates every
 * carrier exists, that the list is non-empty, that there are no
 * duplicate carrier_ids, then keeps the legacy primary +
 * failover_carrier_ids columns in sync (priority asc → primary +
 * failovers) so any legacy reader still sees the right values. */
export function setRoutePlanCarriers(
  planId: string,
  rows: PlanCarrierRow[],
): number {
  if (!getRoutePlanFromDb(planId)) {
    throw new Error(`Route plan ${planId} not found`);
  }
  if (rows.length === 0) {
    throw new Error('At least one carrier is required.');
  }
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.carrier_id)) {
      throw new Error(`Duplicate carrier ${r.carrier_id} in carrier set.`);
    }
    seen.add(r.carrier_id);
    if (!getCarrierFromDb(r.carrier_id)) {
      throw new Error(`Carrier ${r.carrier_id} not found.`);
    }
  }
  const inserted = replaceRoutePlanCarriers(planId, rows);
  const sorted = [...rows].sort((a, b) => a.priority - b.priority);
  updateRoutePlanFields(planId, {
    primary_carrier_id: sorted[0]!.carrier_id,
    failover_carrier_ids_json: JSON.stringify(
      sorted.slice(1).map((r) => r.carrier_id),
    ),
  });
  return inserted;
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
    /** Iter 74 — when provided, replaces the full carrier set on
     * this plan. Validates non-empty + no duplicates. The legacy
     * failover_carrier_ids field is also honoured for callers that
     * haven't been updated yet. */
    carriers: z.array(PlanCarrierRowSchema).optional(),
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

  // Iter 74 — handle a full carrier set replacement up-front so it
  // takes precedence over the legacy failover-only path. Throws on
  // any validation failure; updates the join table AND the legacy
  // primary/failover columns atomically inside setRoutePlanCarriers.
  if (input.carriers !== undefined) {
    setRoutePlanCarriers(id, input.carriers);
  }

  const updates: Parameters<typeof updateRoutePlanFields>[1] = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) {
    updates.description = input.description || null;
  }
  // Only honour the legacy failover_carrier_ids path when the new
  // carriers field wasn't sent — otherwise it'd double-write the
  // failover column and could overwrite what setRoutePlanCarriers
  // just put there.
  if (
    input.carriers === undefined &&
    input.failover_carrier_ids !== undefined
  ) {
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
  const scalarChanged = updateRoutePlanFields(id, updates);
  // Iter 74 — if carriers were replaced, treat the update as successful
  // even when no other scalar fields changed.
  return scalarChanged || input.carriers !== undefined;
}

export type { RoutePlanRecord } from './db';
