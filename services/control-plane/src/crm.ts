// Iter 185 — External CRM API keys + agent-side lookup.
//
// This module owns:
//   1. crm_providers CRUD with encrypted api_key storage
//   2. The lookup function that resolves a phone → contact info
//      via the active provider, dispatching to the per-type
//      handler (generic / hubspot).
//
// The lookup runs server-side only — the api_key is decrypted
// in this process, used to issue an HTTPS request, and never
// returned to the agent's browser.

import { randomUUID } from "crypto";
import { getDb } from './db';
import { decryptSecret, encryptSecret } from './secrets';
import { z } from 'zod';

export type CrmProviderType = 'generic' | 'hubspot';

export interface CrmProviderRow {
  id: string;
  org_id: string;
  provider_type: CrmProviderType;
  name: string;
  base_url: string;
  api_key_encrypted: string | null;
  request_template_json: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

/** What the agent UI sees. The encrypted key is NEVER serialized
 * back to the client — only a has_api_key boolean. */
export interface CrmProviderSafe {
  id: string;
  org_id: string;
  provider_type: CrmProviderType;
  name: string;
  base_url: string;
  has_api_key: boolean;
  request_template_json: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function toSafe(row: CrmProviderRow): CrmProviderSafe {
  return {
    id: row.id,
    org_id: row.org_id,
    provider_type: row.provider_type,
    name: row.name,
    base_url: row.base_url,
    has_api_key: Boolean(row.api_key_encrypted),
    request_template_json: row.request_template_json,
    enabled: row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const CrmProviderTypeSchema = z.enum(['generic', 'hubspot']);

export function listCrmProviders(orgId: string = 'default'): CrmProviderRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM crm_providers WHERE org_id = ? ORDER BY name ASC`,
    )
    .all(orgId) as unknown as CrmProviderRow[];
}

export function getCrmProvider(id: string): CrmProviderRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM crm_providers WHERE id = ?`)
    .get(id) as unknown as CrmProviderRow | undefined;
}

export function getEnabledCrmProvider(
  orgId: string = 'default',
): CrmProviderRow | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM crm_providers WHERE org_id = ? AND enabled = 1 LIMIT 1`,
    )
    .get(orgId) as unknown as CrmProviderRow | undefined;
}

export function insertCrmProvider(args: {
  orgId?: string;
  providerType: CrmProviderType;
  name: string;
  baseUrl: string;
  apiKey?: string | null;
  requestTemplateJson?: string | null;
}): CrmProviderRow {
  const id = randomUUID();
  const orgId = args.orgId ?? 'default';
  const enc = args.apiKey ? encryptSecret(args.apiKey) : null;
  getDb()
    .prepare(
      `INSERT INTO crm_providers
         (id, org_id, provider_type, name, base_url, api_key_encrypted, request_template_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      orgId,
      args.providerType,
      args.name,
      args.baseUrl,
      enc,
      args.requestTemplateJson ?? null,
    );
  return getCrmProvider(id) as CrmProviderRow;
}

export function updateCrmProvider(
  id: string,
  updates: Partial<{
    name: string;
    baseUrl: string;
    apiKey: string | null; // null clears; undefined leaves as-is
    requestTemplateJson: string | null;
  }>,
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.baseUrl !== undefined) {
    fields.push('base_url = ?');
    values.push(updates.baseUrl);
  }
  if (updates.apiKey !== undefined) {
    fields.push('api_key_encrypted = ?');
    values.push(updates.apiKey ? encryptSecret(updates.apiKey) : null);
  }
  if (updates.requestTemplateJson !== undefined) {
    fields.push('request_template_json = ?');
    values.push(updates.requestTemplateJson);
  }
  if (fields.length === 0) return false;
  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  values.push(id);
  const result = getDb()
    .prepare(`UPDATE crm_providers SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]));
  return Number(result.changes) > 0;
}

/** Single-enabled-per-org enforcement: disable all peers in the
 * same org before enabling this one. Wrapped in a transaction. */
export function setCrmProviderEnabled(id: string, enabled: boolean): boolean {
  const row = getCrmProvider(id);
  if (!row) return false;
  const d = getDb();
  d.exec('BEGIN');
  try {
    if (enabled) {
      d.prepare(
        `UPDATE crm_providers SET enabled = 0,
                                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE org_id = ? AND id != ?`,
      ).run(row.org_id, id);
    }
    d.prepare(
      `UPDATE crm_providers SET enabled = ?,
                                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?`,
    ).run(enabled ? 1 : 0, id);
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return true;
}

export function deleteCrmProvider(id: string): boolean {
  const result = getDb().prepare(`DELETE FROM crm_providers WHERE id = ?`).run(id);
  return Number(result.changes) > 0;
}

/* =====================================================================
 * Lookup dispatch
 * =====================================================================
 */

export interface CrmContactResult {
  found: boolean;
  // Provider-shaped contact ID — operator can stash this on the
  // lead row in a follow-up iter for fast re-lookups.
  external_id?: string;
  display_name?: string;
  email?: string;
  company?: string;
  // Generic "additional fields" the agent UI renders as a key/value
  // list. Provider-specific fields go here so the agent UI doesn't
  // need a per-provider renderer.
  attributes?: Record<string, string>;
  // For audit / debug. Never echoed past this.
  provider_status?: number;
  provider_error?: string;
}

/** Resolve a phone number to a CRM contact via the active provider
 * for the caller's org. Returns { found: false } when no provider
 * is configured, key missing, or HTTP non-2xx. */
export async function crmLookupByPhone(
  orgId: string,
  phone: string,
): Promise<CrmContactResult> {
  const provider = getEnabledCrmProvider(orgId);
  if (!provider) {
    return { found: false, provider_error: 'no_provider_configured' };
  }
  if (!provider.api_key_encrypted) {
    return { found: false, provider_error: 'no_api_key' };
  }
  let apiKey: string;
  try {
    apiKey = decryptSecret(provider.api_key_encrypted);
  } catch {
    return { found: false, provider_error: 'decrypt_failed' };
  }

  if (provider.provider_type === 'hubspot') {
    return await hubspotLookup(provider, apiKey, phone);
  }
  if (provider.provider_type === 'generic') {
    return await genericLookup(provider, apiKey, phone);
  }
  return { found: false, provider_error: 'unknown_provider_type' };
}

/* ----- Provider: HubSpot v3 contacts search by phone ----- */
async function hubspotLookup(
  provider: CrmProviderRow,
  apiKey: string,
  phone: string,
): Promise<CrmContactResult> {
  // HubSpot's /crm/v3/objects/contacts/search accepts a phone
  // filter via filterGroups. Returns the first match.
  const url = `${provider.base_url.replace(/\/$/, '')}/crm/v3/objects/contacts/search`;
  const body = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: 'phone',
            operator: 'EQ',
            value: phone,
          },
        ],
      },
    ],
    properties: ['firstname', 'lastname', 'email', 'company'],
    limit: 1,
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // 10s timeout — HubSpot p99 is sub-second but we don't want
      // a slow provider to lock up the agent's UI.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return {
        found: false,
        provider_status: res.status,
        provider_error: `hubspot_${res.status}`,
      };
    }
    const json = (await res.json()) as {
      results?: Array<{
        id: string;
        properties: Record<string, string | null>;
      }>;
    };
    const hit = json.results?.[0];
    if (!hit) {
      return { found: false, provider_status: 200 };
    }
    const p = hit.properties;
    const name =
      [p.firstname, p.lastname].filter(Boolean).join(' ') || undefined;
    return {
      found: true,
      external_id: hit.id,
      display_name: name,
      email: p.email ?? undefined,
      company: p.company ?? undefined,
      attributes: Object.fromEntries(
        Object.entries(p).filter(
          ([, v]) =>
            v != null &&
            !['firstname', 'lastname', 'email', 'company'].includes(
              p[v as string] as string,
            ),
        ) as Array<[string, string]>,
      ),
      provider_status: 200,
    };
  } catch (e) {
    return {
      found: false,
      provider_error: e instanceof Error ? e.message : 'fetch_failed',
    };
  }
}

/* ----- Provider: generic (operator-templated) ----- */
interface GenericTemplate {
  // Path appended to base_url; {phone} placeholder gets filled.
  path_template?: string;
  // GET (default) or POST
  method?: 'GET' | 'POST';
  // Body template (JSON-stringified) for POST; {phone} placeholder.
  body_template?: string;
  // Optional header overrides; values support {api_key} placeholder.
  // The Authorization: Bearer header is added by default — set this
  // to override.
  headers?: Record<string, string>;
  // JSON path expressions to extract fields from the response.
  // Each is a dot-path string, e.g. 'data.contacts.0.email'.
  field_map?: {
    external_id?: string;
    display_name?: string;
    email?: string;
    company?: string;
  };
}

function getByPath(obj: unknown, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (typeof cur !== 'object') return undefined;
    // Allow numeric indices for arrays.
    cur = (cur as Record<string, unknown>)[p];
  }
  if (cur == null) return undefined;
  if (typeof cur === 'string') return cur;
  return String(cur);
}

async function genericLookup(
  provider: CrmProviderRow,
  apiKey: string,
  phone: string,
): Promise<CrmContactResult> {
  let tpl: GenericTemplate = {};
  if (provider.request_template_json) {
    try {
      tpl = JSON.parse(provider.request_template_json) as GenericTemplate;
    } catch {
      return { found: false, provider_error: 'bad_template_json' };
    }
  }
  const method = tpl.method ?? 'GET';
  const path = (tpl.path_template ?? '/contacts/search?phone={phone}').replace(
    '{phone}',
    encodeURIComponent(phone),
  );
  const url = `${provider.base_url.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };
  if (tpl.headers) {
    for (const [k, v] of Object.entries(tpl.headers)) {
      headers[k] = v.replace('{api_key}', apiKey);
    }
  }
  let body: string | undefined;
  if (method === 'POST' && tpl.body_template) {
    body = tpl.body_template.replace('{phone}', phone);
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }
  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return {
        found: false,
        provider_status: res.status,
        provider_error: `generic_${res.status}`,
      };
    }
    const json = (await res.json()) as unknown;
    const map = tpl.field_map ?? {};
    const ext = map.external_id
      ? getByPath(json, map.external_id)
      : undefined;
    const name = map.display_name
      ? getByPath(json, map.display_name)
      : undefined;
    const email = map.email ? getByPath(json, map.email) : undefined;
    const company = map.company ? getByPath(json, map.company) : undefined;
    return {
      found: Boolean(ext || name || email || company),
      external_id: ext,
      display_name: name,
      email,
      company,
      provider_status: 200,
    };
  } catch (e) {
    return {
      found: false,
      provider_error: e instanceof Error ? e.message : 'fetch_failed',
    };
  }
}
