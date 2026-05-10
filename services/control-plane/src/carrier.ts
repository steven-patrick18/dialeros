import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  deleteCarrierFromDb,
  getCarrierFromDb,
  insertCarrier,
  listCarriersFromDb,
  updateCarrierFromDb,
  type CarrierRecord,
} from './db';
import { encryptSecret } from './secrets';

export const CarrierTransportSchema = z.enum(['UDP', 'TCP', 'TLS']);
export type CarrierTransport = z.infer<typeof CarrierTransportSchema>;

export const CarrierAuthModeSchema = z.enum(['digest', 'ip-acl']);
export type CarrierAuthMode = z.infer<typeof CarrierAuthModeSchema>;

export const CodecSchema = z.enum(['PCMU', 'PCMA', 'OPUS', 'G729']);
export type Codec = z.infer<typeof CodecSchema>;

// Iter 44 — destination prefix list. Digits only (NPA/area codes /
// E.164 country prefixes / etc). Each entry is matched as a string
// `startsWith` against the *transformed* destination at originate
// time. NULL/empty list = carrier accepts any destination.
const DialPrefixSchema = z
  .string()
  .min(1)
  .max(15)
  .regex(/^[0-9*#+]+$/, 'Digits / *, # / leading + only.');

// Iter 45 — ViciDial-style dial-plan rewrite rule. When the destination
// startsWith match_prefix, the carrier strips it and prepends one of
// `replacements` instead. `replacements` rotates round-robin across
// calls so traffic spreads evenly when an admin lists multiple area
// codes (e.g. 310,311,312,313,314 to share load).
export const DialPlanRuleSchema = z.object({
  match_prefix: DialPrefixSchema,
  replacements: z.array(DialPrefixSchema).min(1).max(64),
});
export type DialPlanRule = z.infer<typeof DialPlanRuleSchema>;

export const CarrierInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.'),
    host: z.string().min(1, 'Host is required.'),
    port: z.number().int().min(1).max(65535).default(5060),
    transport: CarrierTransportSchema.default('UDP'),
    auth_mode: CarrierAuthModeSchema,
    digest_username: z.string().optional(),
    digest_password: z.string().optional(),
    ip_acl: z.string().optional(),
    codecs: z.array(CodecSchema).min(1).default(['PCMU', 'PCMA']),
    max_channels: z.number().int().min(1).max(10000).default(100),
    max_cps: z.number().int().min(1).max(1000).default(10),
    mos_threshold: z.number().min(0).max(5).default(3.5),
    enabled: z.boolean().default(true),
    dial_prefixes: z.array(DialPrefixSchema).default([]),
    dial_plan_rules: z.array(DialPlanRuleSchema).default([]),
  })
  .refine(
    (d) =>
      d.auth_mode !== 'digest' || (!!d.digest_username && !!d.digest_password),
    {
      message: 'digest_username and digest_password are required for digest auth.',
      path: ['digest_password'],
    },
  )
  .refine(
    (d) => d.auth_mode !== 'ip-acl' || (!!d.ip_acl && d.ip_acl.trim().length > 0),
    {
      message: 'ip_acl is required for ip-acl auth.',
      path: ['ip_acl'],
    },
  );
export type CarrierInput = z.infer<typeof CarrierInputSchema>;

export interface CreateCarrierResult {
  id: string;
}

export function createCarrier(input: CarrierInput): CreateCarrierResult {
  const id = randomUUID();
  const digestPasswordEnc = input.digest_password
    ? encryptSecret(input.digest_password)
    : null;

  insertCarrier({
    id,
    name: input.name,
    host: input.host,
    port: input.port,
    transport: input.transport,
    auth_mode: input.auth_mode,
    digest_username: input.digest_username ?? null,
    digest_password_encrypted: digestPasswordEnc,
    ip_acl: input.ip_acl ?? null,
    codecs: JSON.stringify(input.codecs),
    max_channels: input.max_channels,
    max_cps: input.max_cps,
    mos_threshold: input.mos_threshold,
    enabled: input.enabled,
  });

  // dial_prefixes / dial_plan_rules live on the same table;
  // updateCarrierFromDb handles them because insertCarrier predates
  // these columns. Persist them as a follow-up update so we don't
  // have to widen insertCarrier's signature.
  const followups: Parameters<typeof updateCarrierFromDb>[1] = {};
  if (input.dial_prefixes && input.dial_prefixes.length > 0) {
    followups.dial_prefixes = JSON.stringify(input.dial_prefixes);
  }
  if (input.dial_plan_rules && input.dial_plan_rules.length > 0) {
    followups.dial_plan_rules = JSON.stringify(input.dial_plan_rules);
  }
  if (Object.keys(followups).length > 0) {
    updateCarrierFromDb(id, followups);
  }

  return { id };
}

export function listCarriers(): CarrierRecord[] {
  return listCarriersFromDb();
}

export function getCarrier(id: string): CarrierRecord | undefined {
  return getCarrierFromDb(id);
}

export function deleteCarrier(id: string): boolean {
  return deleteCarrierFromDb(id);
}

// Update schema: every field optional, digest_password empty/missing means
// "keep existing encrypted value".
export const CarrierUpdateInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.')
    .optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  transport: CarrierTransportSchema.optional(),
  auth_mode: CarrierAuthModeSchema.optional(),
  digest_username: z.string().optional(),
  digest_password: z.string().optional(),
  ip_acl: z.string().optional(),
  codecs: z.array(CodecSchema).min(1).optional(),
  max_channels: z.number().int().min(1).max(10000).optional(),
  max_cps: z.number().int().min(1).max(1000).optional(),
  mos_threshold: z.number().min(0).max(5).optional(),
  enabled: z.boolean().optional(),
  // Iter 44 — pass [] to clear the prefix list (carrier accepts all
  // destinations again). Pass null with the same effect.
  dial_prefixes: z.array(DialPrefixSchema).nullable().optional(),
  // Iter 45 — pass [] / null to clear the rewrite-rule list.
  dial_plan_rules: z.array(DialPlanRuleSchema).nullable().optional(),
});
export type CarrierUpdateInput = z.infer<typeof CarrierUpdateInputSchema>;

export function updateCarrier(id: string, input: CarrierUpdateInput): boolean {
  const updates: Parameters<typeof updateCarrierFromDb>[1] = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.host !== undefined) updates.host = input.host;
  if (input.port !== undefined) updates.port = input.port;
  if (input.transport !== undefined) updates.transport = input.transport;
  if (input.auth_mode !== undefined) updates.auth_mode = input.auth_mode;
  if (input.digest_username !== undefined) {
    updates.digest_username = input.digest_username || null;
  }
  if (input.digest_password && input.digest_password.length > 0) {
    updates.digest_password_encrypted = encryptSecret(input.digest_password);
  }
  if (input.ip_acl !== undefined) {
    updates.ip_acl = input.ip_acl || null;
  }
  if (input.codecs !== undefined) {
    updates.codecs = JSON.stringify(input.codecs);
  }
  if (input.max_channels !== undefined) updates.max_channels = input.max_channels;
  if (input.max_cps !== undefined) updates.max_cps = input.max_cps;
  if (input.mos_threshold !== undefined) updates.mos_threshold = input.mos_threshold;
  if (input.enabled !== undefined) updates.enabled = input.enabled;
  if (input.dial_prefixes !== undefined) {
    updates.dial_prefixes =
      input.dial_prefixes === null || input.dial_prefixes.length === 0
        ? null
        : JSON.stringify(input.dial_prefixes);
  }
  if (input.dial_plan_rules !== undefined) {
    updates.dial_plan_rules =
      input.dial_plan_rules === null || input.dial_plan_rules.length === 0
        ? null
        : JSON.stringify(input.dial_plan_rules);
  }
  return updateCarrierFromDb(id, updates);
}

export function parseCodecs(carrier: CarrierRecord): Codec[] {
  try {
    const parsed = JSON.parse(carrier.codecs);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is Codec =>
      ['PCMU', 'PCMA', 'OPUS', 'G729'].includes(c),
    );
  } catch {
    return [];
  }
}

/**
 * Iter 44 — read the carrier's accepted-prefix list. Returns []
 * when none configured (which means "carrier accepts everything").
 */
export function parseDialPrefixes(carrier: CarrierRecord): string[] {
  if (!carrier.dial_prefixes) return [];
  try {
    const parsed = JSON.parse(carrier.dial_prefixes);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );
  } catch {
    return [];
  }
}

/**
 * Iter 44 — does the carrier accept this destination? An empty list
 * means yes-to-everything. Otherwise the destination must startWith
 * one of the prefixes (case-insensitive on `*` / `#`, but those are
 * already canonical-cased). The `+` is normalized away by
 * normalizePhone before this check, so the caller is free to pass
 * either form.
 */
export function carrierAcceptsDestination(
  carrier: CarrierRecord,
  destination: string,
): boolean {
  const prefixes = parseDialPrefixes(carrier);
  if (prefixes.length === 0) return true;
  const dest = destination.replace(/^\+/, '');
  return prefixes.some((p) => dest.startsWith(p));
}

/**
 * Iter 45 — read the carrier's dial-plan rewrite rules. Returns the
 * empty array when none configured (which means "no rewrite, dial
 * destination as-is").
 */
export function parseDialPlanRules(carrier: CarrierRecord): DialPlanRule[] {
  if (!carrier.dial_plan_rules) return [];
  try {
    const parsed = JSON.parse(carrier.dial_plan_rules);
    if (!Array.isArray(parsed)) return [];
    const out: DialPlanRule[] = [];
    for (const r of parsed) {
      const v = DialPlanRuleSchema.safeParse(r);
      if (v.success) out.push(v.data);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Iter 45 — find the first rewrite rule whose match_prefix is a prefix
 * of `destination`. Returns the rule index + the rule itself so the
 * caller can advance a rotation cursor scoped to *that specific rule*
 * before applying it. Returns null when no rule matches (caller should
 * dial the destination as-is).
 */
export function findMatchingDialPlanRule(
  carrier: CarrierRecord,
  destination: string,
): { rule: DialPlanRule; ruleIndex: number } | null {
  const rules = parseDialPlanRules(carrier);
  if (rules.length === 0) return null;
  const dest = destination.replace(/^\+/, '');
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i]!;
    if (dest.startsWith(r.match_prefix)) return { rule: r, ruleIndex: i };
  }
  return null;
}

/**
 * Iter 45 — apply a single rewrite rule using a caller-managed
 * rotation index. Strips `rule.match_prefix` from the destination and
 * prepends `rule.replacements[index % replacements.length]`. Pure /
 * stateless so the rotation cursor lives wherever the caller keeps
 * it (the pacer container, in our case).
 */
export function applyDialPlanRule(
  rule: DialPlanRule,
  destination: string,
  replacementIndex: number,
): string {
  const dest = destination.replace(/^\+/, '');
  const tail = dest.startsWith(rule.match_prefix)
    ? dest.slice(rule.match_prefix.length)
    : dest;
  const replacement =
    rule.replacements[
      Math.abs(replacementIndex) % rule.replacements.length
    ]!;
  return replacement + tail;
}

/**
 * Iter 45 — convenience for callers that want match + apply in one
 * shot using a caller-supplied cursor. Returns `null` when no rule
 * matches.
 */
export function applyDialPlanRules(
  carrier: CarrierRecord,
  destination: string,
  replacementIndex: number,
): { rewritten: string; ruleIndex: number } | null {
  const m = findMatchingDialPlanRule(carrier, destination);
  if (!m) return null;
  return {
    rewritten: applyDialPlanRule(m.rule, destination, replacementIndex),
    ruleIndex: m.ruleIndex,
  };
}

export type { CarrierRecord } from './db';
