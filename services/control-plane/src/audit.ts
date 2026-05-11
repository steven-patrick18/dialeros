import { randomUUID } from 'node:crypto';
import {
  insertAuditEvent,
  listAuditEvents,
  listAuditEventsFiltered,
  listAuditTargetTypes,
  type AuditEventRecord,
} from './db';

export interface AuditAppendInput {
  actorUserId: string | null;
  actorIp: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload?: Record<string, unknown>;
}

export function appendAudit(input: AuditAppendInput): void {
  insertAuditEvent({
    id: randomUUID(),
    actor_user_id: input.actorUserId,
    actor_ip: input.actorIp,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId,
    payload_json: input.payload ? JSON.stringify(input.payload) : null,
  });
}

export function queryAudit(limit = 200): AuditEventRecord[] {
  return listAuditEvents(limit);
}

/** Iter 76 — filtered + cursor-paginated audit query for the
 * /audit page. */
export interface AuditQueryFilter {
  limit?: number;
  actionPrefix?: string | null;
  actorUserId?: string | null;
  targetType?: string | null;
  beforeTs?: string | null;
  afterTs?: string | null;
}

export function queryAuditFiltered(
  filter: AuditQueryFilter,
): AuditEventRecord[] {
  return listAuditEventsFiltered(filter);
}

export function queryAuditTargetTypes(): string[] {
  return listAuditTargetTypes();
}

export type { AuditEventRecord };
