import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  deleteRemoteAgentFromDb,
  getCampaignFromDb,
  getNodeFromDb,
  getRemoteAgentFromDb,
  inFlightForRemoteAgent,
  insertRemoteAgent,
  listRemoteAgentsFromDb,
  updateRemoteAgentFields,
  type RemoteAgentRecord,
} from './db';

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
  if (node.role !== 'telephony') {
    return { error: 'Bound node must have role=telephony.' };
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
    if (node.role !== 'telephony') {
      return { error: 'Bound node must have role=telephony.' };
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

export type { RemoteAgentRecord };
