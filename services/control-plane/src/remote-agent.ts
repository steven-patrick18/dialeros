import { randomBytes, randomUUID } from 'crypto';
import { z } from 'zod';
import {
  deleteRemoteAgentFromDb,
  getCampaignFromDb,
  getNodeFromDb,
  getPrimaryPhoneForUser,
  getRemoteAgentFromDb,
  getUserById,
  getUserByUsername,
  inFlightForRemoteAgent,
  insertRemoteAgent,
  listRemoteAgentsFromDb,
  nodeHasRole,
  updateRemoteAgentFields,
  type RemoteAgentRecord,
} from './db';
import { createUser } from './user-mgmt';
import { createPhone, updatePhone } from './phone';

// Iter 57 — external SIP endpoints (hard phones at remote offices,
// shared trunks to a partner contact centre, etc.) that participate
// in the pacing pool alongside local browser-based agents.
//
// Iter 58 — wired into the pacer's pool / formula / bridge target.
// Iter 59 — friendlier provisioning: pick a telephony node from the
// cluster + type an extension; the SIP URI is constructed for you.
// Optional campaign assignment scopes the remote agent to one
// campaign (NULL = shared across every active campaign).

const ExtensionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9._\-+*#@]+$/, 'Letters, digits, ._-+*#@ only.');

export const RemoteAgentInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.'),
  telephony_node_id: z.string().uuid('Pick a telephony node from the list.'),
  extension: ExtensionSchema,
  campaign_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  lines: z.number().int().min(1).max(64).default(1),
  enabled: z.boolean().default(true),
});
export type RemoteAgentInput = z.infer<typeof RemoteAgentInputSchema>;

export const RemoteAgentUpdateInputSchema = RemoteAgentInputSchema.partial();
export type RemoteAgentUpdateInput = z.infer<
  typeof RemoteAgentUpdateInputSchema
>;

export interface CreateRemoteAgentResult {
  id: string;
}

// Iter 59 — node + extension → sip_uri. We use node.host directly;
// FreeSWITCH bridge syntax accepts the host portion regardless of
// whether it's an IP or DNS name. SIP port stays implicit (5060 /
// transport default) since most setups don't override.
function sipUriFor(nodeHost: string, extension: string): string {
  return `sip:${extension}@${nodeHost}`;
}

export function createRemoteAgent(
  input: RemoteAgentInput,
): CreateRemoteAgentResult | { error: string } {
  const node = getNodeFromDb(input.telephony_node_id);
  if (!node) return { error: `Node ${input.telephony_node_id} not found.` };
  if (!nodeHasRole(node, 'telephony')) {
    return { error: 'Bound node must include the telephony role.' };
  }
  if (input.campaign_id) {
    if (!getCampaignFromDb(input.campaign_id)) {
      return { error: `Campaign ${input.campaign_id} not found.` };
    }
  }
  for (const r of listRemoteAgentsFromDb()) {
    if (r.name === input.name) {
      return { error: `Remote agent "${input.name}" already exists.` };
    }
  }
  const id = randomUUID();
  insertRemoteAgent({
    id,
    name: input.name,
    sip_uri: sipUriFor(node.host, input.extension),
    telephony_node_id: node.id,
    extension: input.extension,
    campaign_id: input.campaign_id ?? null,
    lines: input.lines,
    enabled: input.enabled,
  });
  return { id };
}

export function updateRemoteAgent(
  id: string,
  input: RemoteAgentUpdateInput,
): { changed: boolean } | { error: string } {
  const existing = getRemoteAgentFromDb(id);
  if (!existing) return { error: 'not found' };

  let node = existing.telephony_node_id
    ? getNodeFromDb(existing.telephony_node_id)
    : null;
  if (input.telephony_node_id) {
    node = getNodeFromDb(input.telephony_node_id);
    if (!node) return { error: `Node ${input.telephony_node_id} not found.` };
    if (!nodeHasRole(node, 'telephony')) {
      return { error: 'Bound node must include the telephony role.' };
    }
  }
  if (input.campaign_id) {
    if (!getCampaignFromDb(input.campaign_id)) {
      return { error: `Campaign ${input.campaign_id} not found.` };
    }
  }
  if (input.name && input.name !== existing.name) {
    for (const r of listRemoteAgentsFromDb()) {
      if (r.id !== id && r.name === input.name) {
        return { error: `Remote agent "${input.name}" already exists.` };
      }
    }
  }

  const updates: Parameters<typeof updateRemoteAgentFields>[1] = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.telephony_node_id !== undefined) {
    updates.telephony_node_id = input.telephony_node_id;
  }
  if (input.extension !== undefined) updates.extension = input.extension;
  if (input.campaign_id !== undefined) {
    updates.campaign_id = input.campaign_id ?? null;
  }
  if (input.lines !== undefined) updates.lines = input.lines;
  if (input.enabled !== undefined) updates.enabled = input.enabled;

  // Rebuild sip_uri whenever the node or extension changes so it
  // stays in sync with the structured fields.
  const newExt = input.extension ?? existing.extension;
  if (
    (input.telephony_node_id !== undefined || input.extension !== undefined) &&
    node &&
    newExt
  ) {
    updates.sip_uri = sipUriFor(node.host, newExt);
  }

  return { changed: updateRemoteAgentFields(id, updates) };
}

export function listRemoteAgents(): RemoteAgentRecord[] {
  return listRemoteAgentsFromDb();
}

export function getRemoteAgent(id: string): RemoteAgentRecord | undefined {
  return getRemoteAgentFromDb(id);
}

export function deleteRemoteAgent(id: string): boolean {
  return deleteRemoteAgentFromDb(id);
}

/**
 * Iter 57 — total `lines` capacity across all enabled remote agents.
 * Iter 58 multiplies this into the pacer's dial-level math.
 * Iter 59 — scoped to a campaign: counts agents where campaign_id
 * matches OR is NULL (the shared global pool). Pass null to get
 * the strictly-global capacity (used by the pre-iter-59 UI count).
 */
export function remoteLineCapacity(campaignId?: string | null): number {
  let total = 0;
  for (const r of listRemoteAgentsFromDb()) {
    if (r.enabled !== 1) continue;
    if (campaignId !== undefined && campaignId !== null) {
      if (r.campaign_id !== null && r.campaign_id !== campaignId) continue;
    }
    total += r.lines;
  }
  return total;
}

/**
 * Iter 58 / 59 — enumerate enabled remote agents that the given
 * campaign is allowed to use (its own or the shared pool), with how
 * many lines each has free right now (lines - in_flight). The
 * pacer flattens this into a round-robin pool alongside local
 * agents. Pass campaignId=null/undefined to skip the scope check.
 */
export function listRemoteAgentsWithCapacity(
  campaignId?: string | null,
): Array<{ agent: RemoteAgentRecord; available: number }> {
  const out: Array<{ agent: RemoteAgentRecord; available: number }> = [];
  for (const r of listRemoteAgentsFromDb()) {
    if (r.enabled !== 1) continue;
    if (campaignId !== undefined && campaignId !== null) {
      if (r.campaign_id !== null && r.campaign_id !== campaignId) continue;
    }
    const inFlight = inFlightForRemoteAgent(r.id);
    const available = Math.max(0, r.lines - inFlight);
    out.push({ agent: r, available });
  }
  return out;
}

/** Iter 90 — turn a remote agent's name into a username that passes
 * CreateUserInputSchema (lowercase, [a-z0-9_-]+, len 3..64).
 * "Remote_Agent01" → "remote_agent01". A `remote-` prefix is added
 * if the result collides with an existing username, then `-2`,
 * `-3` … to disambiguate. Length is clamped to 64. */
function sanitizeUsername(name: string): string {
  let base = name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (base.length < 3) base = `remote-${base}`;
  if (base.length > 64) base = base.slice(0, 64);
  let candidate = base;
  let suffix = 2;
  while (getUserByUsername(candidate)) {
    const tail = `-${suffix++}`;
    candidate = base.slice(0, 64 - tail.length) + tail;
    if (suffix > 999) throw new Error('cannot find a free username');
  }
  return candidate;
}

export interface ProvisionUserResult {
  user_id: string;
  username: string;
  phone_id: string;
  extension: string;
  /** Plaintext SIP password. Returned ONCE — the caller surfaces it
   * to the operator so the hard phone / softphone can be
   * configured. Not retrievable afterwards (the phones table stores
   * it but the API doesn't read it back to keep blast radius
   * small). */
  sip_password: string;
  /** Plaintext browser-login password — generated, returned once.
   * Stored only as a hash in users.password_hash. The operator
   * either hands it to the agent or resets it later from /users. */
  login_password: string;
}

/** Iter 90 — back a Remote Agent with a real User + Phone so the
 * external hard-phone / partner SIP endpoint has a first-class
 * identity in the system. Once provisioned:
 *   - The User shows up in /users like any other agent.
 *   - The Phone is registered with FS at the remote agent's
 *     extension; the hard phone uses the returned SIP password to
 *     register.
 *   - Bridges to user/<extension> land on the registered hard
 *     phone (or browser softphone if the user signs in via the web
 *     console too).
 *   - remote_agents.user_id holds the link so the UI can show
 *     "this Remote Agent is backed by <username>". */
export function provisionUserForRemoteAgent(
  remoteAgentId: string,
): ProvisionUserResult | { error: string } {
  const agent = getRemoteAgentFromDb(remoteAgentId);
  if (!agent) return { error: 'remote agent not found' };
  if (agent.user_id) {
    return {
      error: 'remote agent already has a backing user — unlink first',
    };
  }
  if (!agent.extension) {
    return {
      error:
        'remote agent has no extension set — edit it first so the phone has a SIP extension',
    };
  }
  const username = sanitizeUsername(agent.name);
  const sipPassword = randomBytes(9).toString('base64url');
  const loginPassword = randomBytes(9).toString('base64url');

  // createUser auto-provisions a primary phone at the next free
  // 10xx slot. We override it below to match the remote agent's
  // extension so the SIP endpoint registers at the right place.
  let userResult: { id: string };
  try {
    userResult = createUser({
      username,
      password: loginPassword,
      role: 'agent',
      display_name: agent.name,
      skill_tier: 'new',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `failed to create user: ${msg}` };
  }

  // The auto-phone may already be at the correct extension if the
  // remote agent's extension happens to be 3-6 digits matching the
  // sanitized username; otherwise the auto-phone is at next-free
  // 10xx. Either way we patch it to the remote agent's extension
  // and set the SIP password.
  const auto = getPrimaryPhoneForUser(userResult.id);
  let phoneId: string;
  if (auto && auto.extension !== agent.extension) {
    const upd = updatePhone(auto.id, {
      extension: agent.extension,
      password: sipPassword,
    });
    if ('error' in upd) {
      return { error: `failed to set phone extension: ${upd.error}` };
    }
    phoneId = auto.id;
  } else if (auto) {
    // Same extension already; just reset the password to the
    // generated one so we can return it to the operator.
    const upd = updatePhone(auto.id, { password: sipPassword });
    if ('error' in upd) {
      return { error: `failed to reset phone password: ${upd.error}` };
    }
    phoneId = auto.id;
  } else {
    // Auto-provision failed (e.g. 10xx slots exhausted) — create a
    // phone directly at the agent's extension.
    const create = createPhone(userResult.id, {
      extension: agent.extension,
      password: sipPassword,
      protocol: 'sip',
      is_primary: true,
      telephony_node_id: agent.telephony_node_id ?? null,
    });
    if ('error' in create) {
      return { error: `failed to create phone: ${create.error}` };
    }
    phoneId = create.id;
  }

  updateRemoteAgentFields(agent.id, { user_id: userResult.id });

  return {
    user_id: userResult.id,
    username,
    phone_id: phoneId,
    extension: agent.extension,
    sip_password: sipPassword,
    login_password: loginPassword,
  };
}

/** Iter 90 — break the link without deleting either side. The User
 * + Phone keep existing (operator can clean them up in /users if
 * desired). */
export function unlinkRemoteAgentUser(remoteAgentId: string): boolean {
  const agent = getRemoteAgentFromDb(remoteAgentId);
  if (!agent || !agent.user_id) return false;
  return updateRemoteAgentFields(agent.id, { user_id: null });
}

/** Iter 90 — fetch the backing user record (if any) so the UI can
 * show "linked to <username>". */
export function getRemoteAgentUser(remoteAgentId: string) {
  const agent = getRemoteAgentFromDb(remoteAgentId);
  if (!agent || !agent.user_id) return null;
  const user = getUserById(agent.user_id);
  if (!user) return null;
  const phone = getPrimaryPhoneForUser(user.id);
  return {
    user_id: user.id,
    username: user.username,
    display_name: user.display_name,
    is_active: user.is_active === 1,
    phone_id: phone?.id ?? null,
    extension: phone?.extension ?? null,
  };
}

export type { RemoteAgentRecord };
