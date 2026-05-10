import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import {
  countActiveAdmins,
  deactivateUser,
  getUserById,
  getUserByUsername,
  insertUser,
  listUsersFromDb,
  reactivateUser,
  updateUserFields,
  type UserRecord,
} from './db';
import {
  ALL_PERMISSION_SLUGS,
  serializePermissions,
  type PermissionSlug,
} from './permissions';

// Reuses the same scrypt scheme from auth.ts. Kept in sync — if auth.ts
// changes its scheme, change here too.
const SCRYPT_KEYLEN = 64;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export const RoleSchema = z.enum(['admin', 'supervisor', 'operator', 'agent']);
export type Role = z.infer<typeof RoleSchema>;

export const SkillTierSchema = z.enum(['new', 'certified', 'expert']);
export type SkillTier = z.infer<typeof SkillTierSchema>;

export const CreateUserInputSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9_-]+$/, 'Lowercase alphanumeric, dashes/underscores only.'),
  email: z
    .string()
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  password: z.string().min(8, 'Minimum 8 characters.'),
  role: RoleSchema.default('agent'),
  display_name: z.string().max(120).optional(),
  skill_tier: SkillTierSchema.default('new'),
});
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

const PermissionSlugSchema = z
  .string()
  .refine(
    (s): s is PermissionSlug =>
      (ALL_PERMISSION_SLUGS as readonly string[]).includes(s),
    'unknown permission',
  );

export const UpdateUserInputSchema = z.object({
  email: z
    .string()
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  role: RoleSchema.optional(),
  display_name: z.string().max(120).optional().or(z.literal('').transform(() => undefined)),
  skill_tier: SkillTierSchema.optional(),
  password: z.string().min(8).optional(),
  manual_dial: z.boolean().optional(),
  // Iter 43 — explicit ACL grants. Pass null to clear the override
  // and fall back to the role's defaults.
  permissions: z.array(PermissionSlugSchema).nullable().optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;

export interface CreateUserResult {
  id: string;
}

export function createUser(input: CreateUserInput): CreateUserResult {
  if (getUserByUsername(input.username)) {
    throw new Error(`Username "${input.username}" is already taken.`);
  }
  const id = randomUUID();
  insertUser({
    id,
    username: input.username,
    email: input.email ?? null,
    password_hash: hashPassword(input.password),
    role: input.role,
    display_name: input.display_name ?? null,
    skill_tier: input.skill_tier,
  });
  return { id };
}

export interface UpdateUserResult {
  changed: boolean;
  passwordChanged: boolean;
}

export function updateUser(
  id: string,
  input: UpdateUserInput,
): UpdateUserResult | { error: string } {
  const existing = getUserById(id);
  if (!existing) return { error: 'not found' };

  // Refuse to demote the last active admin.
  if (
    input.role !== undefined &&
    input.role !== 'admin' &&
    existing.role === 'admin' &&
    countActiveAdmins() <= 1 &&
    existing.is_active === 1
  ) {
    return { error: 'cannot demote the last active admin' };
  }

  const updates: Parameters<typeof updateUserFields>[1] = {};
  if (input.email !== undefined) updates.email = input.email || null;
  if (input.role !== undefined) updates.role = input.role;
  if (input.display_name !== undefined) {
    updates.display_name = input.display_name || null;
  }
  if (input.skill_tier !== undefined) updates.skill_tier = input.skill_tier;
  if (input.manual_dial !== undefined) updates.manual_dial = input.manual_dial;
  if (input.permissions !== undefined) {
    updates.permissions =
      input.permissions === null
        ? null
        : serializePermissions(input.permissions);
  }

  let passwordChanged = false;
  if (input.password) {
    updates.password_hash = hashPassword(input.password);
    passwordChanged = true;
  }

  const changed = updateUserFields(id, updates);
  return { changed, passwordChanged };
}

export function deactivate(
  id: string,
): { ok: true } | { ok: false; error: string } {
  const result = deactivateUser(id);
  if (result.ok) return { ok: true };
  return { ok: false, error: result.reason };
}

export function reactivate(id: string): boolean {
  return reactivateUser(id);
}

export function listUsers(includeInactive = false): UserRecord[] {
  return listUsersFromDb(includeInactive);
}

export function getUser(id: string): UserRecord | undefined {
  return getUserById(id);
}

export type { UserRecord } from './db';
