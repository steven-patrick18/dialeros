import { randomUUID } from 'crypto';
import { appendAudit } from './audit';
import {
  appendProvisioningLog,
  insertNode,
  updateNodeStatus,
} from './db';
import {
  emitProvisioningEvent,
  type ProvisioningLevel,
} from './event-bus';
import { getRunner } from './runner';
import type { NodeInput, NodeRole } from './schema';

export interface ProvisionResult {
  id: string;
}

export interface ProvisionContext {
  actorUserId?: string | null;
  actorIp?: string | null;
}

export async function provisionNode(
  input: NodeInput,
  ctx: ProvisionContext = {},
): Promise<ProvisionResult> {
  const id = randomUUID();
  const actorUserId = ctx.actorUserId ?? null;
  const actorIp = ctx.actorIp ?? null;

  // Iter 61 — schemas now accept either `role` (legacy single) or
  // `roles` (multi). Normalise to a roles array; the legacy
  // single-role column still gets written for back-compat.
  const roles: NodeRole[] =
    input.roles && input.roles.length > 0
      ? input.roles
      : input.role
        ? [input.role]
        : ['telephony'];
  insertNode({
    id,
    name: input.name,
    host: input.host,
    port: input.port,
    ssh_user: input.ssh_user,
    role: roles[0]!,
    roles,
  });

  appendAudit({
    actorUserId,
    actorIp,
    action: 'node.created',
    targetType: 'node',
    targetId: id,
    payload: {
      name: input.name,
      host: input.host,
      port: input.port,
      role: input.role,
    },
  });

  // Run async — return immediately so the form navigates and the log panel
  // can subscribe to the SSE stream before the first event fires.
  setImmediate(() => {
    void runProvisioning(id, input, { actorUserId, actorIp });
  });

  return { id };
}

async function runProvisioning(
  id: string,
  input: NodeInput,
  ctx: { actorUserId: string | null; actorIp: string | null },
): Promise<void> {
  const emit = (
    level: ProvisioningLevel,
    phase: string,
    message: string,
  ): void => {
    const ts = new Date().toISOString();
    appendProvisioningLog(id, level, phase, message);
    emitProvisioningEvent({ nodeId: id, ts, level, phase, message });
  };

  const runner = getRunner();
  emit('INFO', 'init', `Runner: ${runner.kind}`);

  try {
    const result = await runner.run({ nodeId: id, input, emit });
    if (result.ok) {
      updateNodeStatus(id, 'READY');
      emit('INFO', 'finalize', '✓ Node provisioned. Status: READY.');
      appendAudit({
        actorUserId: ctx.actorUserId,
        actorIp: ctx.actorIp,
        action: 'node.status_changed',
        targetType: 'node',
        targetId: id,
        payload: { status: 'READY' },
      });
    } else {
      updateNodeStatus(id, 'FAILED', result.error);
      emit('ERROR', 'finalize', `✗ Provisioning failed: ${result.error}`);
      appendAudit({
        actorUserId: ctx.actorUserId,
        actorIp: ctx.actorIp,
        action: 'node.status_changed',
        targetType: 'node',
        targetId: id,
        payload: { status: 'FAILED', error: result.error },
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    updateNodeStatus(id, 'FAILED', message);
    emit('ERROR', 'finalize', `✗ Provisioning crashed: ${message}`);
    appendAudit({
      actorUserId: ctx.actorUserId,
      actorIp: ctx.actorIp,
      action: 'node.status_changed',
      targetType: 'node',
      targetId: id,
      payload: { status: 'FAILED', error: message },
    });
  }
}
