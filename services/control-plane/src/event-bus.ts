import { EventEmitter } from 'node:events';

// In-process pub/sub for provisioning events.
// One bus per Node process. Survives Next.js HMR via globalThis cache.
//
// When control-plane is split into its own service (Phase 0 iter 3+),
// this gets replaced with Redis Streams or NATS so multiple web nodes
// can share the bus.

declare global {
  // eslint-disable-next-line no-var
  var __dialeros_eventbus: EventEmitter | undefined;
}

function bus(): EventEmitter {
  if (!globalThis.__dialeros_eventbus) {
    const e = new EventEmitter();
    e.setMaxListeners(0);
    globalThis.__dialeros_eventbus = e;
  }
  return globalThis.__dialeros_eventbus;
}

export type ProvisioningLevel = 'INFO' | 'WARN' | 'ERROR' | 'PHASE';

export interface ProvisioningEvent {
  nodeId: string;
  ts: string;
  level: ProvisioningLevel;
  phase: string;
  message: string;
}

export function emitProvisioningEvent(ev: ProvisioningEvent): void {
  bus().emit(`provisioning:${ev.nodeId}`, ev);
}

export function subscribeToNode(
  nodeId: string,
  fn: (ev: ProvisioningEvent) => void,
): () => void {
  const channel = `provisioning:${nodeId}`;
  bus().on(channel, fn);
  return () => {
    bus().off(channel, fn);
  };
}
