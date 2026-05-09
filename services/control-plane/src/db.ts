import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { NodeRecord, NodeRole, NodeStatus } from './schema';

const DB_PATH =
  process.env.DIALEROS_DB ?? resolve(process.cwd(), 'data', 'dialeros.db');

let _db: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const d = new DatabaseSync(DB_PATH);
  d.exec('PRAGMA journal_mode = WAL');
  d.exec('PRAGMA foreign_keys = ON');
  d.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      ssh_user TEXT NOT NULL DEFAULT 'root',
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROVISIONING',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS provisioning_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      level TEXT NOT NULL,
      phase TEXT NOT NULL,
      message TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_provlogs_node
      ON provisioning_logs (node_id, id);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      actor_user_id TEXT,
      actor_ip TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      payload_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_events(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor_user_id);

    CREATE TRIGGER IF NOT EXISTS audit_no_update
    BEFORE UPDATE ON audit_events
    BEGIN
      SELECT RAISE(ABORT, 'audit_events is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS audit_no_delete
    BEFORE DELETE ON audit_events
    BEGIN
      SELECT RAISE(ABORT, 'audit_events is append-only');
    END;

    CREATE TABLE IF NOT EXISTS carriers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 5060,
      transport TEXT NOT NULL DEFAULT 'UDP',
      auth_mode TEXT NOT NULL,
      digest_username TEXT,
      digest_password_encrypted TEXT,
      ip_acl TEXT,
      codecs TEXT NOT NULL DEFAULT '["PCMU","PCMA"]',
      max_channels INTEGER NOT NULL DEFAULT 100,
      max_cps INTEGER NOT NULL DEFAULT 10,
      mos_threshold REAL NOT NULL DEFAULT 3.5,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_carriers_enabled ON carriers(enabled);

    CREATE TABLE IF NOT EXISTS route_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      primary_carrier_id TEXT NOT NULL REFERENCES carriers(id),
      failover_carrier_ids_json TEXT NOT NULL DEFAULT '[]',
      cid_strategy TEXT NOT NULL DEFAULT 'passthrough',
      cid_single TEXT,
      cid_pool_json TEXT NOT NULL DEFAULT '[]',
      transform_strip_prefix TEXT,
      transform_add_prefix TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_route_plans_primary ON route_plans(primary_carrier_id);
    CREATE INDEX IF NOT EXISTS idx_route_plans_enabled ON route_plans(enabled);

    CREATE TABLE IF NOT EXISTS lead_lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lead_lists(id) ON DELETE CASCADE,
      phone TEXT NOT NULL,
      name TEXT,
      email TEXT,
      custom_fields_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'NEW',
      last_called_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (list_id, phone)
    );

    CREATE INDEX IF NOT EXISTS idx_leads_list_status ON leads(list_id, status);
    CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
  `);
  _db = d;
  return d;
}

// =====================================================================
// nodes
// =====================================================================

export function insertNode(rec: {
  id: string;
  name: string;
  host: string;
  port: number;
  ssh_user: string;
  role: NodeRole;
}): void {
  db()
    .prepare(
      `INSERT INTO nodes (id, name, host, port, ssh_user, role) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(rec.id, rec.name, rec.host, rec.port, rec.ssh_user, rec.role);
}

export function updateNodeStatus(
  id: string,
  status: NodeStatus,
  errorMessage?: string | null,
): void {
  db()
    .prepare(
      `UPDATE nodes SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .run(status, errorMessage ?? null, id);
}

export function listNodesFromDb(): NodeRecord[] {
  return db()
    .prepare(`SELECT * FROM nodes ORDER BY created_at DESC`)
    .all() as unknown as NodeRecord[];
}

export function getNodeFromDb(id: string): NodeRecord | undefined {
  return db()
    .prepare(`SELECT * FROM nodes WHERE id = ?`)
    .get(id) as unknown as NodeRecord | undefined;
}

// =====================================================================
// provisioning logs
// =====================================================================

export interface ProvisioningLogRecord {
  id: number;
  node_id: string;
  ts: string;
  level: string;
  phase: string;
  message: string;
}

export function appendProvisioningLog(
  nodeId: string,
  level: string,
  phase: string,
  message: string,
): void {
  db()
    .prepare(
      `INSERT INTO provisioning_logs (node_id, level, phase, message) VALUES (?, ?, ?, ?)`,
    )
    .run(nodeId, level, phase, message);
}

export function getProvisioningLogs(
  nodeId: string,
  sinceId = 0,
): ProvisioningLogRecord[] {
  return db()
    .prepare(
      `SELECT * FROM provisioning_logs WHERE node_id = ? AND id > ? ORDER BY id ASC`,
    )
    .all(nodeId, sinceId) as unknown as ProvisioningLogRecord[];
}

// =====================================================================
// users
// =====================================================================

export interface UserRecord {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export function countUsers(): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM users`)
    .get() as { n: number };
  return row.n;
}

export function insertUser(rec: {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  role: string;
}): void {
  db()
    .prepare(
      `INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(rec.id, rec.username, rec.email, rec.password_hash, rec.role);
}

export function getUserByUsername(username: string): UserRecord | undefined {
  return db()
    .prepare(`SELECT * FROM users WHERE username = ?`)
    .get(username) as unknown as UserRecord | undefined;
}

export function getUserById(id: string): UserRecord | undefined {
  return db()
    .prepare(`SELECT * FROM users WHERE id = ?`)
    .get(id) as unknown as UserRecord | undefined;
}

// =====================================================================
// sessions
// =====================================================================

export interface SessionRecord {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
}

export function insertSession(rec: {
  id: string;
  user_id: string;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
}): void {
  db()
    .prepare(
      `INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(rec.id, rec.user_id, rec.expires_at, rec.ip, rec.user_agent);
}

export function getSessionById(id: string): SessionRecord | undefined {
  return db()
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(id) as unknown as SessionRecord | undefined;
}

export function deleteSession(id: string): void {
  db().prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
}

export function deleteExpiredSessions(): number {
  const result = db()
    .prepare(`DELETE FROM sessions WHERE expires_at < ?`)
    .run(new Date().toISOString());
  return Number(result.changes);
}

// =====================================================================
// audit events
// =====================================================================

export interface AuditEventRecord {
  id: string;
  ts: string;
  actor_user_id: string | null;
  actor_ip: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload_json: string | null;
}

export function insertAuditEvent(rec: {
  id: string;
  actor_user_id: string | null;
  actor_ip: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload_json: string | null;
}): void {
  db()
    .prepare(
      `INSERT INTO audit_events (id, actor_user_id, actor_ip, action, target_type, target_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.id,
      rec.actor_user_id,
      rec.actor_ip,
      rec.action,
      rec.target_type,
      rec.target_id,
      rec.payload_json,
    );
}

export function listAuditEvents(limit = 200): AuditEventRecord[] {
  return db()
    .prepare(`SELECT * FROM audit_events ORDER BY ts DESC LIMIT ?`)
    .all(limit) as unknown as AuditEventRecord[];
}

// =====================================================================
// carriers
// =====================================================================

export interface CarrierRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  transport: string;
  auth_mode: string;
  digest_username: string | null;
  digest_password_encrypted: string | null;
  ip_acl: string | null;
  codecs: string;
  max_channels: number;
  max_cps: number;
  mos_threshold: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function insertCarrier(rec: {
  id: string;
  name: string;
  host: string;
  port: number;
  transport: string;
  auth_mode: string;
  digest_username: string | null;
  digest_password_encrypted: string | null;
  ip_acl: string | null;
  codecs: string;
  max_channels: number;
  max_cps: number;
  mos_threshold: number;
  enabled: boolean;
}): void {
  db()
    .prepare(
      `INSERT INTO carriers (
        id, name, host, port, transport, auth_mode,
        digest_username, digest_password_encrypted, ip_acl,
        codecs, max_channels, max_cps, mos_threshold, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.id,
      rec.name,
      rec.host,
      rec.port,
      rec.transport,
      rec.auth_mode,
      rec.digest_username,
      rec.digest_password_encrypted,
      rec.ip_acl,
      rec.codecs,
      rec.max_channels,
      rec.max_cps,
      rec.mos_threshold,
      rec.enabled ? 1 : 0,
    );
}

export function listCarriersFromDb(): CarrierRecord[] {
  return db()
    .prepare(`SELECT * FROM carriers ORDER BY created_at DESC`)
    .all() as unknown as CarrierRecord[];
}

export function getCarrierFromDb(id: string): CarrierRecord | undefined {
  return db()
    .prepare(`SELECT * FROM carriers WHERE id = ?`)
    .get(id) as unknown as CarrierRecord | undefined;
}

export function deleteCarrierFromDb(id: string): boolean {
  const result = db().prepare(`DELETE FROM carriers WHERE id = ?`).run(id);
  return Number(result.changes) > 0;
}

export function updateCarrierFromDb(
  id: string,
  updates: Partial<{
    name: string;
    host: string;
    port: number;
    transport: string;
    auth_mode: string;
    digest_username: string | null;
    digest_password_encrypted: string | null;
    ip_acl: string | null;
    codecs: string;
    max_channels: number;
    max_cps: number;
    mos_threshold: number;
    enabled: boolean;
  }>,
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    if (key === 'enabled') values.push(value ? 1 : 0);
    else values.push(value as string | number | null);
  }
  if (fields.length === 0) return false;
  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);
  const result = db()
    .prepare(`UPDATE carriers SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]));
  return Number(result.changes) > 0;
}

// =====================================================================
// route plans
// =====================================================================

export interface RoutePlanRecord {
  id: string;
  name: string;
  description: string | null;
  primary_carrier_id: string;
  failover_carrier_ids_json: string;
  cid_strategy: string;
  cid_single: string | null;
  cid_pool_json: string;
  transform_strip_prefix: string | null;
  transform_add_prefix: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function insertRoutePlan(rec: {
  id: string;
  name: string;
  description: string | null;
  primary_carrier_id: string;
  failover_carrier_ids_json: string;
  cid_strategy: string;
  cid_single: string | null;
  cid_pool_json: string;
  transform_strip_prefix: string | null;
  transform_add_prefix: string | null;
  enabled: boolean;
}): void {
  db()
    .prepare(
      `INSERT INTO route_plans (
        id, name, description, primary_carrier_id, failover_carrier_ids_json,
        cid_strategy, cid_single, cid_pool_json,
        transform_strip_prefix, transform_add_prefix, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.id,
      rec.name,
      rec.description,
      rec.primary_carrier_id,
      rec.failover_carrier_ids_json,
      rec.cid_strategy,
      rec.cid_single,
      rec.cid_pool_json,
      rec.transform_strip_prefix,
      rec.transform_add_prefix,
      rec.enabled ? 1 : 0,
    );
}

export function listRoutePlansFromDb(): RoutePlanRecord[] {
  return db()
    .prepare(`SELECT * FROM route_plans ORDER BY created_at DESC`)
    .all() as unknown as RoutePlanRecord[];
}

export function getRoutePlanFromDb(id: string): RoutePlanRecord | undefined {
  return db()
    .prepare(`SELECT * FROM route_plans WHERE id = ?`)
    .get(id) as unknown as RoutePlanRecord | undefined;
}

export function deleteRoutePlanFromDb(id: string): boolean {
  const result = db().prepare(`DELETE FROM route_plans WHERE id = ?`).run(id);
  return Number(result.changes) > 0;
}

// =====================================================================
// lead lists + leads
// =====================================================================

export interface LeadListRecord {
  id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface LeadRecord {
  id: string;
  list_id: string;
  phone: string;
  name: string | null;
  email: string | null;
  custom_fields_json: string;
  status: string;
  last_called_at: string | null;
  created_at: string;
  updated_at: string;
}

export function insertLeadList(rec: {
  id: string;
  name: string;
  description: string | null;
}): void {
  db()
    .prepare(
      `INSERT INTO lead_lists (id, name, description) VALUES (?, ?, ?)`,
    )
    .run(rec.id, rec.name, rec.description);
}

export function listLeadListsFromDb(): LeadListRecord[] {
  return db()
    .prepare(`SELECT * FROM lead_lists ORDER BY created_at DESC`)
    .all() as unknown as LeadListRecord[];
}

export function getLeadListFromDb(id: string): LeadListRecord | undefined {
  return db()
    .prepare(`SELECT * FROM lead_lists WHERE id = ?`)
    .get(id) as unknown as LeadListRecord | undefined;
}

export function deleteLeadListFromDb(id: string): boolean {
  const result = db().prepare(`DELETE FROM lead_lists WHERE id = ?`).run(id);
  return Number(result.changes) > 0;
}

export function countLeadsInList(listId: string): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM leads WHERE list_id = ?`)
    .get(listId) as { n: number };
  return row.n;
}

export interface LeadStatusBreakdown {
  status: string;
  count: number;
}

export function leadStatusBreakdown(listId: string): LeadStatusBreakdown[] {
  return db()
    .prepare(
      `SELECT status, COUNT(*) AS count FROM leads WHERE list_id = ? GROUP BY status ORDER BY count DESC`,
    )
    .all(listId) as unknown as LeadStatusBreakdown[];
}

export function listLeadsInList(
  listId: string,
  limit = 50,
  offset = 0,
): LeadRecord[] {
  return db()
    .prepare(
      `SELECT * FROM leads WHERE list_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(listId, limit, offset) as unknown as LeadRecord[];
}

/**
 * Bulk-insert leads. Uses INSERT OR IGNORE on UNIQUE (list_id, phone)
 * so duplicates within a list are silently dropped.
 *
 * Returns { inserted, skipped } where skipped = duplicates of (list_id, phone).
 */
export function insertLeadsBulk(
  rows: Array<{
    id: string;
    list_id: string;
    phone: string;
    name: string | null;
    email: string | null;
  }>,
): { inserted: number; skipped: number } {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };
  const d = db();
  const stmt = d.prepare(
    `INSERT OR IGNORE INTO leads (id, list_id, phone, name, email) VALUES (?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  d.exec('BEGIN');
  try {
    for (const r of rows) {
      const result = stmt.run(r.id, r.list_id, r.phone, r.name, r.email);
      if (Number(result.changes) > 0) inserted++;
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return { inserted, skipped: rows.length - inserted };
}

// Returns route plans where the given carrier appears as primary OR failover.
export function listRoutePlansUsingCarrier(
  carrierId: string,
): RoutePlanRecord[] {
  // SQLite has no array search; do a LIKE on the JSON column for failovers,
  // plus a direct match on primary. Ambiguous matches (e.g. carrier id is a
  // substring of another id) aren't possible because UUIDs are unique strings.
  const pattern = `%"${carrierId}"%`;
  return db()
    .prepare(
      `SELECT * FROM route_plans
       WHERE primary_carrier_id = ?
          OR failover_carrier_ids_json LIKE ?
       ORDER BY created_at DESC`,
    )
    .all(carrierId, pattern) as unknown as RoutePlanRecord[];
}
