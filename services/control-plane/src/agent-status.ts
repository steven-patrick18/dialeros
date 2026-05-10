import {
  getAgentStatus as dbGetAgentStatus,
  setAgentStatus as dbSetAgentStatus,
  type AgentStatusRecord,
} from './db';

// Iter 40 — agent presence. AVAILABLE means the pacer can pull live
// calls to this user. PAUSED means the pacer's pickAgent skips them
// — a paused agent can still use their softphone manually (if they
// have manual_dial), they just don't get fed by campaigns.

export type AgentStatusValue = 'AVAILABLE' | 'PAUSED';

export function getStatus(userId: string): AgentStatusRecord {
  return dbGetAgentStatus(userId);
}

export function pauseAgent(userId: string, reason: string | null): void {
  dbSetAgentStatus(userId, 'PAUSED', reason);
}

export function resumeAgent(userId: string): void {
  dbSetAgentStatus(userId, 'AVAILABLE', null);
}

export type { AgentStatusRecord };
