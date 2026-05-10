import { randomUUID } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import {
  findNodeByHost,
  insertNode,
  listNodesFromDb,
  parseNodeRoles,
  updateNodeRoles,
} from './db';
import type { NodeRecord, NodeRole } from './schema';

// Iter 61 — auto-register the local host as a node so a single-box
// install doesn't have to manually click through /cluster/nodes/add
// before the rest of the system (remote-agent form, telephony health
// dashboard, ...) sees a telephony node exist.
//
// We pick the first non-internal IPv4 we can find and use it as the
// node's host. If a node with that host already exists we leave it
// alone except to make sure its roles include the SINGLE_BOX_ROLES
// set — that way an admin who upgraded from iter ≤60 (where role was
// a single value) gets their existing row promoted to multi-role on
// first boot of iter 61.

const SINGLE_BOX_ROLES: NodeRole[] = ['web', 'database', 'telephony'];

function pickLocalIp(): string {
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

export function ensureLocalNodeRegistered(): NodeRecord {
  const host = pickLocalIp();

  // Prefer an explicit is_self=1 row if one exists already.
  const all = listNodesFromDb();
  let self = all.find((n) => n.is_self === 1);
  if (!self) self = findNodeByHost(host);

  if (self) {
    // Promote roles to the single-box set if anything's missing.
    const existing = new Set(parseNodeRoles(self));
    let changed = false;
    for (const r of SINGLE_BOX_ROLES) {
      if (!existing.has(r)) {
        existing.add(r);
        changed = true;
      }
    }
    if (changed) {
      updateNodeRoles(self.id, Array.from(existing) as NodeRole[]);
    }
    return self;
  }

  // First boot of a fresh install — create the row.
  const id = randomUUID();
  insertNode({
    id,
    name: hostname() || 'this-host',
    host,
    port: 22,
    ssh_user: 'root',
    role: 'telephony',
    roles: SINGLE_BOX_ROLES,
    is_self: true,
    status: 'READY',
  });
  return findNodeByHost(host)!;
}
