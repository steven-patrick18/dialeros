import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  bulkInsertCidGroupNumbers,
  countCidsInGroupFromDb,
  deleteCidGroupFromDb,
  deleteCidGroupNumberFromDb,
  getCidGroupFromDb,
  insertCidGroup,
  listCidGroupsFromDb,
  listCidsInGroupFromDb,
  listRoutePlansUsingCidGroup,
  updateCidGroupFields,
  type CidGroupNumberRecord,
  type CidGroupRecord,
  type RoutePlanRecord,
} from './db';

const PHONE_NUMBER_RE = /^\+?[0-9]{4,20}$/;

export const CidGroupStrategySchema = z.enum([
  'rotate',
  'random',
  'sticky_by_area',
]);
export type CidGroupStrategy = z.infer<typeof CidGroupStrategySchema>;

export const CID_GROUP_STRATEGY_HINTS: Record<CidGroupStrategy, string> = {
  rotate:
    'Round-robin through the group. Pacer picks the next number on every call.',
  random: 'Pick a random number from the group on every call.',
  sticky_by_area:
    'Prefer a number whose area-code prefix matches the lead. Falls back to round-robin if no match.',
};

export const CidGroupInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.'),
  description: z.string().max(500).optional(),
  strategy: CidGroupStrategySchema.default('rotate'),
});
export type CidGroupInput = z.infer<typeof CidGroupInputSchema>;

export const CidGroupUpdateInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.')
    .optional(),
  description: z.string().max(500).optional(),
  strategy: CidGroupStrategySchema.optional(),
});
export type CidGroupUpdateInput = z.infer<typeof CidGroupUpdateInputSchema>;

/** Parses a free-form blob (newlines, commas, whitespace) into an
 * array of canonicalised E.164-ish numbers. Rejects entries that
 * don't match PHONE_NUMBER_RE. Returns { ok, accepted, rejected }. */
export function parseCidNumberBlob(raw: string): {
  accepted: string[];
  rejected: string[];
} {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const accepted: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const tok of tokens) {
    // Strip common formatting (spaces, parentheses, dashes, dots)
    const cleaned = tok.replace(/[\s().-]/g, '');
    if (!PHONE_NUMBER_RE.test(cleaned)) {
      rejected.push(tok);
      continue;
    }
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    accepted.push(cleaned);
  }
  return { accepted, rejected };
}

export interface CreateCidGroupResult {
  id: string;
}

export function createCidGroup(input: CidGroupInput): CreateCidGroupResult {
  const id = randomUUID();
  insertCidGroup({
    id,
    name: input.name,
    description: input.description ?? null,
    strategy: input.strategy,
  });
  return { id };
}

export function listCidGroups(): CidGroupRecord[] {
  return listCidGroupsFromDb();
}

export function getCidGroup(id: string): CidGroupRecord | undefined {
  return getCidGroupFromDb(id);
}

export function updateCidGroup(
  id: string,
  input: CidGroupUpdateInput,
): boolean {
  const existing = getCidGroupFromDb(id);
  if (!existing) throw new Error(`CID group ${id} not found.`);
  const updates: Parameters<typeof updateCidGroupFields>[1] = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) {
    updates.description = input.description || null;
  }
  if (input.strategy !== undefined) updates.strategy = input.strategy;
  return updateCidGroupFields(id, updates);
}

export function deleteCidGroup(id: string): boolean {
  // Block delete when in-use by a route plan to avoid silent breakage.
  const using = listRoutePlansUsingCidGroup(id);
  if (using.length > 0) {
    throw new Error(
      `CID group is attached to ${using.length} route plan(s): ${using
        .map((p) => p.name)
        .join(', ')}. Detach first.`,
    );
  }
  return deleteCidGroupFromDb(id);
}

export function listCidsInGroup(groupId: string): CidGroupNumberRecord[] {
  return listCidsInGroupFromDb(groupId);
}

export function countCidsInGroup(groupId: string): number {
  return countCidsInGroupFromDb(groupId);
}

export interface AddCidsResult {
  inserted: number;
  rejected: string[];
}

/** Adds one or more numbers to a group. Accepts a free-form blob
 * (newlines / commas / whitespace) or a pre-split array. Idempotent —
 * duplicate (group_id, number) silently no-ops at the DB layer. */
export function addCidsToGroup(
  groupId: string,
  raw: string | string[],
): AddCidsResult {
  const existing = getCidGroupFromDb(groupId);
  if (!existing) throw new Error(`CID group ${groupId} not found.`);
  const blob = Array.isArray(raw) ? raw.join('\n') : raw;
  const { accepted, rejected } = parseCidNumberBlob(blob);
  if (accepted.length === 0) {
    return { inserted: 0, rejected };
  }
  const rows = accepted.map((number) => ({ id: randomUUID(), number }));
  const inserted = bulkInsertCidGroupNumbers(groupId, rows);
  return { inserted, rejected };
}

export function removeCidFromGroup(numberId: string): boolean {
  return deleteCidGroupNumberFromDb(numberId);
}

/** Helpers consumed by route-plan and pacer. */

export function parseCidGroupIds(plan: RoutePlanRecord): string[] {
  try {
    const parsed = JSON.parse(plan.cid_group_ids_json);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string')
      : [];
  } catch {
    return [];
  }
}

export type { CidGroupRecord, CidGroupNumberRecord };
