import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  countLeadsFiltered,
  countLeadsInList,
  deleteLeadFromDb,
  deleteLeadListFromDb,
  findLeadByPhone,
  getCampaignFromDb,
  getCampaignLeadListIds,
  getLeadById,
  getLeadListFromDb,
  insertLeadList,
  insertLeadsBulk,
  insertSingleLead,
  leadHangupCauseBreakdown,
  leadListTimezoneBreakdown,
  leadStatusBreakdown,
  listCallHistoryForLead,
  listLeadListsForCampaign,
  listLeadListsFromDb,
  listLeadsFiltered,
  listLeadsInList,
  moveLeadListToCampaign,
  setCampaignLeadLists,
  updateLeadFields,
  updateLeadListFields,
  type LeadCallHistoryRow,
  type LeadFilterOpts,
  type LeadListRecord,
  type LeadRecord,
  type LeadStatusBreakdown,
} from './db';
import { inferLeadTimezone } from './timezones';

// Phone shape: digits with optional +, dashes, spaces, parens. Min 4 digits,
// max 20 digits. Loose by design — different countries have different formats
// and route plans handle final transforms before dialing.
const PHONE_RE = /^\+?[\d\s\-()]{4,30}$/;

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function normalizePhone(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  if (!PHONE_RE.test(trimmed)) return null;
  const digits = digitsOnly(trimmed);
  if (digits.length < 4 || digits.length > 20) return null;
  // Preserve leading + if present.
  return trimmed.startsWith('+') ? '+' + digits : digits;
}

export const LeadListInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.'),
  description: z.string().max(500).optional(),
  // Iter 23 — a list optionally belongs to a campaign at creation time.
  // Omit (or pass null) to create the list unattached and assign it later
  // from the campaign create form or the lead-list move flow.
  campaign_id: z.string().uuid().nullable().optional(),
});
export type LeadListInput = z.infer<typeof LeadListInputSchema>;

export interface CreateLeadListResult {
  id: string;
}

export function createLeadList(input: LeadListInput): CreateLeadListResult {
  const id = randomUUID();
  insertLeadList({
    id,
    name: input.name,
    description: input.description ?? null,
    campaign_id: input.campaign_id ?? null,
  });
  return { id };
}

export function listLeadLists(): LeadListRecord[] {
  return listLeadListsFromDb();
}

export function getLeadList(id: string): LeadListRecord | undefined {
  return getLeadListFromDb(id);
}

// Iter 41 — partial-update for the lead-list detail page's inline form.
// Only `name` and `description` are mutable; campaign reassignment goes
// through the existing moveLeadList flow.
export const LeadListUpdateInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.')
    .optional(),
  description: z
    .string()
    .max(500)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});
export type LeadListUpdateInput = z.infer<typeof LeadListUpdateInputSchema>;

export function updateLeadList(
  id: string,
  input: LeadListUpdateInput,
): { changed: boolean } | { error: string } {
  if (!getLeadListFromDb(id)) return { error: 'not found' };
  const updates: Parameters<typeof updateLeadListFields>[1] = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) {
    updates.description = input.description || null;
  }
  return { changed: updateLeadListFields(id, updates) };
}

/**
 * Iter 23 — move a list to a different campaign, or detach it (null).
 * The pacer reads lead_lists.campaign_id every tick, so this is enough
 * to redirect dialing on the next tick — no service restart needed.
 *
 * Returns false if the list doesn't exist, throws if the target campaign
 * doesn't exist (to surface bad input loudly rather than silently
 * orphaning a list).
 */
export function moveLeadList(
  leadListId: string,
  campaignId: string | null,
): boolean {
  if (!getLeadListFromDb(leadListId)) return false;
  if (campaignId !== null && !getCampaignFromDb(campaignId)) {
    throw new Error(`Campaign ${campaignId} not found.`);
  }
  return moveLeadListToCampaign(leadListId, campaignId);
}

export function leadListsForCampaign(
  campaignId: string,
): LeadListRecord[] {
  return listLeadListsForCampaign(campaignId);
}

/**
 * Iter 24 — replace the campaign's lead-list set in one transaction.
 * Validates each id exists; throws on bad input. Returns counts so the
 * API can report what changed in the audit payload.
 */
export function setLeadListsForCampaign(
  campaignId: string,
  leadListIds: string[],
): { detached: number; attached: number; moved: number } {
  if (!getCampaignFromDb(campaignId)) {
    throw new Error(`Campaign ${campaignId} not found.`);
  }
  for (const id of leadListIds) {
    if (!getLeadListFromDb(id)) {
      throw new Error(`Lead list ${id} not found.`);
    }
  }
  return setCampaignLeadLists(campaignId, leadListIds);
}

export function deleteLeadList(id: string): boolean {
  return deleteLeadListFromDb(id);
}

export function leadCountFor(listId: string): number {
  return countLeadsInList(listId);
}

export function leadBreakdown(listId: string): LeadStatusBreakdown[] {
  return leadStatusBreakdown(listId);
}

/**
 * Iter 60 — bucket a list's leads by inferred TZ (from phone NPA /
 * country code). Returned rows sort by descending count so the UI
 * answers "where is the biggest chunk of this list right now?".
 */
export function leadTimezoneBreakdown(
  listId: string,
): Array<{ tz: string; count: number }> {
  return leadListTimezoneBreakdown(listId, inferLeadTimezone);
}

export function pageLeads(
  listId: string,
  page: number,
  pageSize = 50,
): LeadRecord[] {
  const offset = Math.max(0, (page - 1) * pageSize);
  return listLeadsInList(listId, pageSize, offset);
}

/** Iter 80 — paginated, status- and search-filterable view of a
 * list's leads. Backs the drill-down on the lead list page where
 * clicking a status count opens just those rows, plus the search
 * box for finding a single lead by phone / name / email substring. */
export function pageLeadsFiltered(
  listId: string,
  opts: {
    status?: string | null;
    search?: string | null;
    page?: number;
    pageSize?: number;
  },
): { rows: LeadRecord[]; total: number } {
  const pageSize = opts.pageSize ?? 50;
  const page = Math.max(1, opts.page ?? 1);
  const offset = (page - 1) * pageSize;
  const filter: LeadFilterOpts = {
    status: opts.status ?? null,
    search: opts.search ?? null,
    limit: pageSize,
    offset,
  };
  return {
    rows: listLeadsFiltered(listId, filter),
    total: countLeadsFiltered(listId, filter),
  };
}

/** Iter 80 — last hangup-cause per lead in this list, grouped &
 * counted. Used for the SIP-style breakdown panel on the lead list
 * page. */
export function leadCauseBreakdown(
  listId: string,
): Array<{ cause: string; count: number }> {
  return leadHangupCauseBreakdown(listId);
}

// =====================================================================
// CSV ingest
// =====================================================================

export interface CsvIngestResult {
  parsed: number;
  inserted: number;
  duplicates: number;
  rejected: number;
  rejections: Array<{ row: number; reason: string }>;
}

const PHONE_HEADERS = new Set([
  'phone',
  'phone_number',
  'phonenumber',
  'telephone',
  'tel',
  'mobile',
  'cell',
  'number',
]);
const NAME_HEADERS = new Set([
  'name',
  'full_name',
  'fullname',
  'first_name',
  'firstname',
]);
const EMAIL_HEADERS = new Set(['email', 'email_address', 'emailaddress']);

/**
 * Parse a single CSV line respecting double-quote escaping. Doesn't handle
 * embedded newlines in quoted fields (rare for lead data) — split source by
 * line first, then call this on each line.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ',') {
        out.push(cur);
        cur = '';
      } else if (c === '"' && cur === '') {
        inQuotes = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function ingestCsv(listId: string, csv: string): CsvIngestResult {
  const result: CsvIngestResult = {
    parsed: 0,
    inserted: 0,
    duplicates: 0,
    rejected: 0,
    rejections: [],
  };

  // Strip BOM, split on any newline style.
  const text = csv.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return result;

  // Detect headers — first row IS headers if it has a recognizable phone column.
  const firstCells = parseCsvLine(lines[0]!).map((s) => s.toLowerCase());
  const hasHeader = firstCells.some((c) => PHONE_HEADERS.has(c));

  let phoneIdx = 0;
  let nameIdx = -1;
  let emailIdx = -1;
  let dataStart = 0;

  if (hasHeader) {
    phoneIdx = firstCells.findIndex((c) => PHONE_HEADERS.has(c));
    nameIdx = firstCells.findIndex((c) => NAME_HEADERS.has(c));
    emailIdx = firstCells.findIndex((c) => EMAIL_HEADERS.has(c));
    dataStart = 1;
  } else {
    // No headers: assume column 0 is phone, 1 is name, 2 is email.
    phoneIdx = 0;
    nameIdx = lines[0]!.split(',').length > 1 ? 1 : -1;
    emailIdx = lines[0]!.split(',').length > 2 ? 2 : -1;
    dataStart = 0;
  }

  const rows: Array<{
    id: string;
    list_id: string;
    phone: string;
    name: string | null;
    email: string | null;
    timezone: string | null;
  }> = [];

  for (let i = dataStart; i < lines.length; i++) {
    result.parsed++;
    const cells = parseCsvLine(lines[i]!);
    const rawPhone = cells[phoneIdx];
    if (!rawPhone) {
      result.rejected++;
      result.rejections.push({ row: i + 1, reason: 'missing phone' });
      continue;
    }
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      result.rejected++;
      result.rejections.push({
        row: i + 1,
        reason: `invalid phone: ${rawPhone}`,
      });
      continue;
    }
    rows.push({
      id: randomUUID(),
      list_id: listId,
      phone,
      name: nameIdx >= 0 ? (cells[nameIdx] ?? null) || null : null,
      email: emailIdx >= 0 ? (cells[emailIdx] ?? null) || null : null,
      // Iter 91 — infer + store the lead's TZ at ingest so the
      // TZ-aware list orders can filter without a backfill round
      // trip.
      timezone: inferLeadTimezone(phone) ?? null,
    });
  }

  const { inserted, skipped } = insertLeadsBulk(rows);
  result.inserted = inserted;
  result.duplicates = skipped;
  return result;
}

/** Iter 92 — single-lead fetch for the detail page. */
export function getLead(id: string): LeadRecord | undefined {
  return getLeadById(id);
}

/** Iter 92 — paginated call history for one lead. */
export function leadCallHistory(
  leadId: string,
  limit = 50,
): LeadCallHistoryRow[] {
  return listCallHistoryForLead(leadId, limit);
}

const LeadUpdateInputSchema = z.object({
  name: z
    .string()
    .max(120)
    .optional()
    .or(z.literal('').transform(() => null)),
  email: z
    .string()
    .max(120)
    .optional()
    .or(z.literal('').transform(() => null)),
  status: z
    .enum([
      'NEW',
      'CALLED_NO_ANSWER',
      'BUSY',
      'CALLBACK_SCHEDULED',
      'CONVERTED',
      'DNC',
      'DNC_TEMP',
      'BAD_NUMBER',
      'DIALING',
    ])
    .optional(),
  callback_at: z.string().optional().or(z.literal('').transform(() => null)),
  timezone: z
    .string()
    .max(64)
    .optional()
    .or(z.literal('').transform(() => null)),
});
export type LeadUpdateInput = z.infer<typeof LeadUpdateInputSchema>;
export { LeadUpdateInputSchema };

/** Iter 92 — partial update on a lead. Phone intentionally NOT
 * editable: it's a load-bearing key for DNC matching, call
 * history correlation, and timezone inference. Operators delete +
 * recreate to "edit" a phone. */
export function updateLead(
  id: string,
  input: LeadUpdateInput,
): { changed: boolean } | { error: string } {
  const existing = getLeadById(id);
  if (!existing) return { error: 'not found' };
  return { changed: updateLeadFields(id, input) };
}

/** Iter 92 — hard-delete one lead. dial_intents cascade-deletes
 * via the schema FK. */
export function deleteLead(id: string): boolean {
  return deleteLeadFromDb(id);
}

export type { LeadCallHistoryRow };
export type { LeadListRecord, LeadRecord, LeadStatusBreakdown } from './db';

/** Iter 93 — find a lead by phone within a campaign's attached
 * lists, or create one in the first attached list if nothing
 * matches. Used by the manual-dial path so the dial_intent row
 * always has a valid lead_id — that's what makes the manual call
 * show up on the campaign Real-time panel + the lead detail page.
 *
 * Returns null when the campaign has no lead lists attached (and
 * therefore there's nowhere to drop a synthetic lead). Caller
 * decides whether that's a hard error or a "skip the dial_intent
 * insert and just audit" fallback. */
export function findOrCreateLeadForManualDial(
  phone: string,
  campaignId: string,
): string | null {
  const listIds = getCampaignLeadListIds(campaignId);
  if (listIds.length === 0) return null;
  const existing = findLeadByPhone(phone, listIds);
  if (existing) return existing.id;
  // No existing lead — synthesize one in the first attached list
  // so the dial_intent FK stays valid. Tagged with name = "Manual
  // dial" so an operator scanning the list page sees how it got
  // there.
  const id = randomUUID();
  return insertSingleLead({
    id,
    list_id: listIds[0]!,
    phone,
    name: 'Manual dial',
    email: null,
    status: 'NEW',
  });
}
