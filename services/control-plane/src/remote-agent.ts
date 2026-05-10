import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  deleteRemoteAgentFromDb,
  getNodeFromDb,
  getRemoteAgentFromDb,
  inFlightForRemoteAgent,
  insertRemoteAgent,
  listRemoteAgentsFromDb,
  updateRemoteAgentFields,
  type RemoteAgentRecord,
} from './db';

// Iter 57 — external SIP endpoints (hard phones at remote offices,
// shared trunks to a partner call centre, etc.) that participate in
// the pacing formula alongside local browser-based agents.
//
// This iter ships provisioning only: an admin can list/add/edit/
// delete remote agents. Iter 58 wires the `lines` field into the
// pacer's dial-level math so the formula
// (local_agents + Σ remote_agent_lines) × dial_level
// actually drives concurrency.

export const RemoteAgentInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Alphanumeric, dashes, underscores only.'),
  sip_uri: z
    .string()
    .min(1)
    .max(200)
    .regex(
      /^sip:[^@]+@[^@\s]+$/,
      'Must be a sip: URI like sip:1500@10.0.0.5 or sip:agent@partner.example.',
    ),
  telephony_node_id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
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

export function createRemoteAgent(
  input: RemoteAgentInput,
): CreateRemoteAgentResult | { error: string } {
  if (input.telephony_node_id) {
    const node = getNodeFromDb(input.telephony_node_id);
    if (!node) return { error: `Node ${input.telephony_node_id} not found.` };
    if (node.role !== 'telephony') {
      return { error: 'Bound node must have role=telephony.' };
    }
  }
  // sqlite UNIQUE(name) catches duplicates at insert; pre-check anyway
  // so we can return a clean error instead of a SQLITE_CONSTRAINT
  // exception bubbling up.
  for (const r of listRemoteAgentsFromDb()) {
    if (r.name === input.name) {
      return { error: `Remote agent "${input.name}" already exists.` };
    }
  }
  const id = randomUUID();
  insertRemoteAgent({
    id,
    name: input.name,
    sip_uri: input.sip_uri,
    telephony_node_id: input.telephony_node_id ?? null,
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

  if (input.telephony_node_id) {
    const node = getNodeFromDb(input.telephony_node_id);
    if (!node) return { error: `Node ${input.telephony_node_id} not found.` };
    if (node.role !== 'telephony') {
      return { error: 'Bound node must have role=telephony.' };
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
  if (input.sip_uri !== undefined) updates.sip_uri = input.sip_uri;
  if (input.telephony_node_id !== undefined) {
    updates.telephony_node_id = input.telephony_node_id ?? null;
  }
  if (input.lines !== undefined) updates.lines = input.lines;
  if (input.enabled !== undefined) updates.enabled = input.enabled;
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
 * Iter 58 multiplies this into the pacer's dial-level math:
 *   target_concurrency = (local_agents + remoteLineCapacity()) * dial_level
 */
export function remoteLineCapacity(): number {
  let total = 0;
  for (const r of listRemoteAgentsFromDb()) {
    if (r.enabled === 1) total += r.lines;
  }
  return total;
}

/**
 * Iter 58 — enumerate enabled remote agents with the slot count each
 * has free right now (lines - in_flight). The pacer flattens this
 * into a round-robin pool alongside local agents and picks bridge
 * targets from it. Capacity reads off live dial_intent rows so we
 * survive restarts without drift.
 */
export function listRemoteAgentsWithCapacity(): Array<{
  agent: RemoteAgentRecord;
  available: number;
}> {
  const out: Array<{ agent: RemoteAgentRecord; available: number }> = [];
  for (const r of listRemoteAgentsFromDb()) {
    if (r.enabled !== 1) continue;
    const inFlight = inFlightForRemoteAgent(r.id);
    const available = Math.max(0, r.lines - inFlight);
    out.push({ agent: r, available });
  }
  return out;
}

export type { RemoteAgentRecord };
