import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  deleteRoutePlanFromDb,
  getCarrierFromDb,
  getRoutePlanFromDb,
  insertRoutePlan,
  listRoutePlansFromDb,
  listRoutePlansUsingCarrier,
  type RoutePlanRecord,
} from './db';

export const CidStrategySchema = z.enum(['passthrough', 'single', 'rotate']);
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

export type { RoutePlanRecord } from './db';
