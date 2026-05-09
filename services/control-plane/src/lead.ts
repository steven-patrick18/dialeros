import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  countLeadsInList,
  deleteLeadListFromDb,
  getLeadListFromDb,
  insertLeadList,
  insertLeadsBulk,
  leadStatusBreakdown,
  listLeadListsFromDb,
  listLeadsInList,
  type LeadListRecord,
  type LeadRecord,
  type LeadStatusBreakdown,
} from './db';

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
  });
  return { id };
}

export function listLeadLists(): LeadListRecord[] {
  return listLeadListsFromDb();
}

export function getLeadList(id: string): LeadListRecord | undefined {
  return getLeadListFromDb(id);
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

export function pageLeads(
  listId: string,
  page: number,
  pageSize = 50,
): LeadRecord[] {
  const offset = Math.max(0, (page - 1) * pageSize);
  return listLeadsInList(listId, pageSize, offset);
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
    });
  }

  const { inserted, skipped } = insertLeadsBulk(rows);
  result.inserted = inserted;
  result.duplicates = skipped;
  return result;
}

export type { LeadListRecord, LeadRecord, LeadStatusBreakdown } from './db';
