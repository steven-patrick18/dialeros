import { z } from 'zod';
import {
  attachDidToInGroup,
  deleteDid,
  detachDidFromInGroup,
  findDidOwner,
  getDidWithOwner,
  getInGroupFromDb,
  listAllDids,
  reassignDidToInGroup,
  type DidWithOwner,
} from './db';
import { normalizePhone } from './lead';

// Iter 22 — first-class DID management.
//
// Each DID currently lives in exactly one in_group via the in_group_dids
// table. Until now those rows could only be created from inside a single
// in-group's detail page; this module exposes the same data + bulk ops
// as the standalone /dids page expects.

export const DidNumberSchema = z
  .string()
  .min(1, 'DID is required.')
  .max(40, 'DID is too long.');

export const SingleDidInputSchema = z.object({
  did: DidNumberSchema,
  in_group_id: z.string().uuid('in_group_id must be a UUID.'),
});
export type SingleDidInput = z.infer<typeof SingleDidInputSchema>;

export const BulkDidInputSchema = z.object({
  in_group_id: z.string().uuid('in_group_id must be a UUID.'),
  // Either a multiline blob (paste-friendly) or a parsed array.
  dids: z.array(z.string()).min(1, 'Provide at least one DID.').max(5000),
});
export type BulkDidInput = z.infer<typeof BulkDidInputSchema>;

export interface BulkDidResult {
  attempted: number;
  added: string[];
  skipped: Array<{
    raw: string;
    reason: 'invalid_format' | 'already_attached';
    existingOwner?: string;
  }>;
}

/**
 * Parse a paste-friendly multiline blob of DIDs. Splits on any
 * whitespace, comma, or semicolon. Returns the original tokens (not
 * normalized) so the caller can normalize and report invalids.
 */
export function parseDidBlob(blob: string): string[] {
  return blob
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function addDid(input: SingleDidInput): {
  ok: boolean;
  did?: string;
  error?: 'invalid_format' | 'already_attached' | 'in_group_missing';
  existingOwner?: string;
} {
  if (!getInGroupFromDb(input.in_group_id)) {
    return { ok: false, error: 'in_group_missing' };
  }
  const normalized = normalizePhone(input.did);
  if (!normalized) return { ok: false, error: 'invalid_format' };
  const owner = findDidOwner(normalized);
  if (owner) {
    return { ok: false, error: 'already_attached', existingOwner: owner };
  }
  attachDidToInGroup(input.in_group_id, normalized);
  return { ok: true, did: normalized };
}

export function bulkAddDids(input: BulkDidInput): BulkDidResult {
  if (!getInGroupFromDb(input.in_group_id)) {
    throw new Error(`In-group ${input.in_group_id} not found.`);
  }
  const result: BulkDidResult = {
    attempted: input.dids.length,
    added: [],
    skipped: [],
  };
  for (const raw of input.dids) {
    const normalized = normalizePhone(raw);
    if (!normalized) {
      result.skipped.push({ raw, reason: 'invalid_format' });
      continue;
    }
    const owner = findDidOwner(normalized);
    if (owner) {
      result.skipped.push({
        raw,
        reason: 'already_attached',
        existingOwner: owner,
      });
      continue;
    }
    attachDidToInGroup(input.in_group_id, normalized);
    result.added.push(normalized);
  }
  return result;
}

/**
 * Clone an existing DID's settings (currently just the owning in-group)
 * into a new DID number. Useful for "set up DID 555-2 the same way as
 * DID 555-1." When richer per-DID settings land (per-DID call menu,
 * per-DID office hours, etc.) this function is the place to copy them.
 */
export function cloneDidSettings(
  sourceDid: string,
  newDid: string,
): { ok: boolean; did?: string; error?: string; existingOwner?: string } {
  const source = getDidWithOwner(sourceDid);
  if (!source) return { ok: false, error: 'source_not_found' };
  return addDid({ did: newDid, in_group_id: source.in_group_id });
}

export function moveDid(
  did: string,
  newInGroupId: string,
): { ok: boolean; error?: 'did_not_found' | 'in_group_missing' } {
  if (!getInGroupFromDb(newInGroupId)) {
    return { ok: false, error: 'in_group_missing' };
  }
  if (!getDidWithOwner(did)) {
    return { ok: false, error: 'did_not_found' };
  }
  reassignDidToInGroup(did, newInGroupId);
  return { ok: true };
}

export function removeDid(did: string): boolean {
  return deleteDid(did);
}

export { listAllDids, getDidWithOwner, type DidWithOwner };

// Convenience for the in-group's own page — keeps backward compat.
export { detachDidFromInGroup };
