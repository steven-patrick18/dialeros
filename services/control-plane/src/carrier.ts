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

export type { CarrierRecord } from './db';
