import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import {
  countUsers,
  deleteSession,
  getSessionById,
  getUserById,
  getUserByUsername,
  insertSession,
  insertUser,
  type UserRecord,
} from './db';

// RoleSchema lives in user-mgmt.ts now (broader set incl. 'agent').

export const SetupInputSchema = z.object({
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
});
export type SetupInput = z.infer<typeof SetupInputSchema>;

export const LoginInputSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// scryptSync blocks the event loop ~50-100ms per call. Acceptable for an
// admin GUI with rare logins. Swap to async scrypt if/when this becomes
// a hot path.
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexHash] = parts;
  const computed = scryptSync(password, salt!, SCRYPT_KEYLEN);
  const expected = Buffer.from(hexHash!, 'hex');
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

export function userCount(): number {
  return countUsers();
}

export function isSetupComplete(): boolean {
  return countUsers() > 0;
}

interface CreateSessionInput {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

function createSession(input: CreateSessionInput): string {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  insertSession({
    id,
    user_id: input.userId,
    expires_at: expiresAt,
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
  });
  return id;
}

export interface LoginResult {
  user: UserRecord;
  sessionId: string;
}

export function createFirstAdmin(
  input: SetupInput,
  ctx: { ip?: string | null; userAgent?: string | null } = {},
): LoginResult {
  if (countUsers() > 0) {
    throw new Error('Setup already completed.');
  }
  const id = randomUUID();
  insertUser({
    id,
    username: input.username,
    email: input.email ?? null,
    password_hash: hashPassword(input.password),
    role: 'admin',
  });
  const sessionId = createSession({
    userId: id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { user: getUserById(id)!, sessionId };
}

export function login(
  input: LoginInput,
  ctx: { ip?: string | null; userAgent?: string | null } = {},
): LoginResult | null {
  const user = getUserByUsername(input.username);
  if (!user) return null;
  if (user.is_active === 0) return null; // deactivated → indistinguishable from "wrong password"
  if (!verifyPassword(input.password, user.password_hash)) return null;
  const sessionId = createSession({
    userId: user.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { user, sessionId };
}

export function logout(sessionId: string): void {
  deleteSession(sessionId);
}

export function getUserBySession(sessionId: string): UserRecord | null {
  const session = getSessionById(sessionId);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    deleteSession(sessionId);
    return null;
  }
  const user = getUserById(session.user_id);
  if (!user) return null;
  // Deactivated users get logged out on the next request — defense in depth
  // even though deactivateUser() also deletes their existing sessions.
  if (user.is_active === 0) {
    deleteSession(sessionId);
    return null;
  }
  return user;
}

export type { UserRecord } from './db';
