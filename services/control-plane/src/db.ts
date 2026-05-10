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
      display_name TEXT,
      skill_tier TEXT NOT NULL DEFAULT 'new',
      is_active INTEGER NOT NULL DEFAULT 1,
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

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'outbound_manual',
      status TEXT NOT NULL DEFAULT 'paused',
      route_plan_id TEXT NOT NULL REFERENCES route_plans(id),
      base_ratio REAL NOT NULL DEFAULT 1.0,
      call_window_start TEXT,
      call_window_end TEXT,
      max_abandon_pct REAL NOT NULL DEFAULT 3.0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_campaigns_route_plan ON campaigns(route_plan_id);
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

    CREATE TABLE IF NOT EXISTS campaign_lead_lists (
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      lead_list_id TEXT NOT NULL REFERENCES lead_lists(id) ON DELETE CASCADE,
      priority INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (campaign_id, lead_list_id)
    );

    CREATE INDEX IF NOT EXISTS idx_cll_lead_list ON campaign_lead_lists(lead_list_id);

    CREATE TABLE IF NOT EXISTS in_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'inbound_queue',
      whitelist_mode TEXT NOT NULL DEFAULT 'none',
      whitelist_static_json TEXT NOT NULL DEFAULT '[]',
      routing_strategy TEXT NOT NULL DEFAULT 'ring_all',
      max_wait_seconds INTEGER NOT NULL DEFAULT 60,
      wrap_up_seconds INTEGER NOT NULL DEFAULT 10,
      off_list_action TEXT NOT NULL DEFAULT 'reject',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS in_group_dids (
      in_group_id TEXT NOT NULL REFERENCES in_groups(id) ON DELETE CASCADE,
      did TEXT NOT NULL UNIQUE,
      PRIMARY KEY (in_group_id, did)
    );

    CREATE INDEX IF NOT EXISTS idx_in_group_dids_did ON in_group_dids(did);

    CREATE TABLE IF NOT EXISTS dial_intents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      route_plan_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      transformed_phone TEXT NOT NULL,
      cid_used TEXT,
      kind TEXT NOT NULL DEFAULT 'simulated'
    );

    CREATE INDEX IF NOT EXISTS idx_dial_intents_campaign_id
      ON dial_intents(campaign_id, id);

    CREATE TABLE IF NOT EXISTS user_campaigns (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, campaign_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_campaigns_campaign
      ON user_campaigns(campaign_id);

    CREATE TABLE IF NOT EXISTS user_in_groups (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      in_group_id TEXT NOT NULL REFERENCES in_groups(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, in_group_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_in_groups_in_group
      ON user_in_groups(in_group_id);
  `);

  // Idempotent ALTERs — sqlite has no IF NOT EXISTS for columns. We
  // try each one; "duplicate column name" errors mean it's already
  // applied (harmless). Any other error gets propagated.
  const migrations: string[] = [
    "ALTER TABLE users ADD COLUMN display_name TEXT",
    "ALTER TABLE users ADD COLUMN skill_tier TEXT NOT NULL DEFAULT 'new'",
    "ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
  ];
  for (const sql of migrations) {
    try {
      d.exec(sql);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('duplicate column name')) {
        throw e;
      }
    }
  }

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
  display_name: string | null;
  skill_tier: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export function countUsers(): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM users`)
    .get() as { n: number };
  return row.n;
}

export function countActiveAdmins(): number {
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1`,
    )
    .get() as { n: number };
  return row.n;
}

export function insertUser(rec: {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  role: string;
  display_name?: string | null;
  skill_tier?: string;
}): void {
  db()
    .prepare(
      `INSERT INTO users (id, username, email, password_hash, role, display_name, skill_tier) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.id,
      rec.username,
      rec.email,
      rec.password_hash,
      rec.role,
      rec.display_name ?? null,
      rec.skill_tier ?? 'new',
    );
}

export function listUsersFromDb(includeInactive = false): UserRecord[] {
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  return db()
    .prepare(`SELECT * FROM users ${where} ORDER BY username ASC`)
    .all() as unknown as UserRecord[];
}

export function updateUserFields(
  id: string,
  updates: Partial<{
    email: string | null;
    role: string;
    display_name: string | null;
    skill_tier: string;
    is_active: boolean;
    password_hash: string;
  }>,
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    if (key === 'is_active') values.push(value ? 1 : 0);
    else values.push(value as string | null);
  }
  if (fields.length === 0) return false;
  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);
  const result = db()
    .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]));
  return Number(result.changes) > 0;
}

// Soft delete via is_active=0. Refuse if it would leave 0 active admins.
export function deactivateUser(id: string): { ok: true } | { ok: false; reason: string } {
  const u = db().prepare(`SELECT * FROM users WHERE id = ?`).get(id) as
    | UserRecord
    | undefined;
  if (!u) return { ok: false, reason: 'not found' };
  if (u.is_active === 0) return { ok: false, reason: 'already inactive' };
  if (u.role === 'admin' && countActiveAdmins() <= 1) {
    return {
      ok: false,
      reason: 'cannot deactivate the last active admin',
    };
  }
  db()
    .prepare(
      `UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .run(id);
  // Also kill any open sessions for this user.
  db().prepare(`DELETE FROM sessions WHERE user_id = ?`).run(id);
  return { ok: true };
}

export function reactivateUser(id: string): boolean {
  const result = db()
    .prepare(
      `UPDATE users SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .run(id);
  return Number(result.changes) > 0;
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

// =====================================================================
// user attachments (user → campaigns / in-groups)
// =====================================================================

export function getUserCampaignIds(userId: string): string[] {
  const rows = db()
    .prepare(
      `SELECT campaign_id FROM user_campaigns WHERE user_id = ? ORDER BY campaign_id ASC`,
    )
    .all(userId) as Array<{ campaign_id: string }>;
  return rows.map((r) => r.campaign_id);
}

export function getUserInGroupIds(userId: string): string[] {
  const rows = db()
    .prepare(
      `SELECT in_group_id FROM user_in_groups WHERE user_id = ? ORDER BY in_group_id ASC`,
    )
    .all(userId) as Array<{ in_group_id: string }>;
  return rows.map((r) => r.in_group_id);
}

export function getCampaignAllowedUserIds(campaignId: string): string[] {
  const rows = db()
    .prepare(
      `SELECT user_id FROM user_campaigns WHERE campaign_id = ? ORDER BY user_id ASC`,
    )
    .all(campaignId) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

export function getInGroupAllowedUserIds(inGroupId: string): string[] {
  const rows = db()
    .prepare(
      `SELECT user_id FROM user_in_groups WHERE in_group_id = ? ORDER BY user_id ASC`,
    )
    .all(inGroupId) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

/**
 * Replace the user's allowed-campaign set with the given list.
 * Returns the diff (added, removed) — useful for audit logs.
 */
export function setUserCampaigns(
  userId: string,
  campaignIds: string[],
): { added: string[]; removed: string[] } {
  const d = db();
  const current = new Set(getUserCampaignIds(userId));
  const target = new Set(campaignIds);
  const added = [...target].filter((id) => !current.has(id));
  const removed = [...current].filter((id) => !target.has(id));

  d.exec('BEGIN');
  try {
    if (removed.length > 0) {
      const placeholders = removed.map(() => '?').join(',');
      d.prepare(
        `DELETE FROM user_campaigns WHERE user_id = ? AND campaign_id IN (${placeholders})`,
      ).run(userId, ...removed);
    }
    if (added.length > 0) {
      const stmt = d.prepare(
        `INSERT OR IGNORE INTO user_campaigns (user_id, campaign_id) VALUES (?, ?)`,
      );
      for (const cid of added) {
        stmt.run(userId, cid);
      }
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return { added, removed };
}

export function setUserInGroups(
  userId: string,
  inGroupIds: string[],
): { added: string[]; removed: string[] } {
  const d = db();
  const current = new Set(getUserInGroupIds(userId));
  const target = new Set(inGroupIds);
  const added = [...target].filter((id) => !current.has(id));
  const removed = [...current].filter((id) => !target.has(id));

  d.exec('BEGIN');
  try {
    if (removed.length > 0) {
      const placeholders = removed.map(() => '?').join(',');
      d.prepare(
        `DELETE FROM user_in_groups WHERE user_id = ? AND in_group_id IN (${placeholders})`,
      ).run(userId, ...removed);
    }
    if (added.length > 0) {
      const stmt = d.prepare(
        `INSERT OR IGNORE INTO user_in_groups (user_id, in_group_id) VALUES (?, ?)`,
      );
      for (const igid of added) {
        stmt.run(userId, igid);
      }
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return { added, removed };
}

// =====================================================================
// dial intents (pacing engine output)
// =====================================================================

export interface DialIntentRecord {
  id: number;
  ts: string;
  campaign_id: string;
  lead_id: string;
  route_plan_id: string;
  phone: string;
  transformed_phone: string;
  cid_used: string | null;
  kind: string;
}

export function insertDialIntent(rec: {
  campaign_id: string;
  lead_id: string;
  route_plan_id: string;
  phone: string;
  transformed_phone: string;
  cid_used: string | null;
  kind?: string;
}): DialIntentRecord {
  const result = db()
    .prepare(
      `INSERT INTO dial_intents (campaign_id, lead_id, route_plan_id, phone, transformed_phone, cid_used, kind) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.campaign_id,
      rec.lead_id,
      rec.route_plan_id,
      rec.phone,
      rec.transformed_phone,
      rec.cid_used,
      rec.kind ?? 'simulated',
    );
  const id = Number(result.lastInsertRowid);
  return db()
    .prepare(`SELECT * FROM dial_intents WHERE id = ?`)
    .get(id) as unknown as DialIntentRecord;
}

export function listDialIntentsForCampaign(
  campaignId: string,
  limit = 100,
  sinceId = 0,
): DialIntentRecord[] {
  return db()
    .prepare(
      `SELECT * FROM dial_intents WHERE campaign_id = ? AND id > ? ORDER BY id DESC LIMIT ?`,
    )
    .all(campaignId, sinceId, limit) as unknown as DialIntentRecord[];
}

export function countDialIntentsForCampaign(campaignId: string): number {
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM dial_intents WHERE campaign_id = ?`,
    )
    .get(campaignId) as { n: number };
  return row.n;
}

/**
 * Pacing's lead picker. Returns the next dialable lead from the campaign's
 * attached lists, ordered by priority. A lead is dialable if:
 *   - status in (NEW, CALLED_NO_ANSWER, CALLBACK_SCHEDULED)
 *   - last_called_at is NULL OR older than `cooldownSeconds` ago
 */
export function pickNextDialableLead(
  campaignId: string,
  cooldownSeconds: number,
): { lead_id: string; list_id: string; phone: string; name: string | null } | undefined {
  const cutoff = new Date(
    Date.now() - cooldownSeconds * 1000,
  ).toISOString();
  return db()
    .prepare(
      `SELECT l.id AS lead_id, l.list_id, l.phone, l.name
       FROM leads l
       JOIN campaign_lead_lists cll ON cll.lead_list_id = l.list_id
       WHERE cll.campaign_id = ?
         AND l.status IN ('NEW', 'CALLED_NO_ANSWER', 'CALLBACK_SCHEDULED')
         AND (l.last_called_at IS NULL OR l.last_called_at < ?)
       ORDER BY cll.priority ASC,
                CASE WHEN l.last_called_at IS NULL THEN 0 ELSE 1 END,
                l.last_called_at ASC,
                l.created_at ASC
       LIMIT 1`,
    )
    .get(campaignId, cutoff) as
    | { lead_id: string; list_id: string; phone: string; name: string | null }
    | undefined;
}

export function markLeadDialed(
  leadId: string,
  newStatus = 'CALLED_NO_ANSWER',
): void {
  db()
    .prepare(
      `UPDATE leads SET status = ?, last_called_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .run(newStatus, leadId);
}

// =====================================================================
// in-groups
// =====================================================================

export interface InGroupRecord {
  id: string;
  name: string;
  description: string | null;
  type: string;
  whitelist_mode: string;
  whitelist_static_json: string;
  routing_strategy: string;
  max_wait_seconds: number;
  wrap_up_seconds: number;
  off_list_action: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface InGroupDidRecord {
  in_group_id: string;
  did: string;
}

export function insertInGroup(rec: {
  id: string;
  name: string;
  description: string | null;
  type: string;
  whitelist_mode: string;
  whitelist_static_json: string;
  routing_strategy: string;
  max_wait_seconds: number;
  wrap_up_seconds: number;
  off_list_action: string;
  enabled: boolean;
}): void {
  db()
    .prepare(
      `INSERT INTO in_groups (
        id, name, description, type,
        whitelist_mode, whitelist_static_json,
        routing_strategy, max_wait_seconds, wrap_up_seconds,
        off_list_action, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.id,
      rec.name,
      rec.description,
      rec.type,
      rec.whitelist_mode,
      rec.whitelist_static_json,
      rec.routing_strategy,
      rec.max_wait_seconds,
      rec.wrap_up_seconds,
      rec.off_list_action,
      rec.enabled ? 1 : 0,
    );
}

export function listInGroupsFromDb(): InGroupRecord[] {
  return db()
    .prepare(`SELECT * FROM in_groups ORDER BY created_at DESC`)
    .all() as unknown as InGroupRecord[];
}

export function getInGroupFromDb(id: string): InGroupRecord | undefined {
  return db()
    .prepare(`SELECT * FROM in_groups WHERE id = ?`)
    .get(id) as unknown as InGroupRecord | undefined;
}

export function deleteInGroupFromDb(id: string): boolean {
  const result = db().prepare(`DELETE FROM in_groups WHERE id = ?`).run(id);
  return Number(result.changes) > 0;
}

export function listDidsForInGroup(inGroupId: string): string[] {
  const rows = db()
    .prepare(
      `SELECT did FROM in_group_dids WHERE in_group_id = ? ORDER BY did ASC`,
    )
    .all(inGroupId) as Array<{ did: string }>;
  return rows.map((r) => r.did);
}

export function findDidOwner(did: string): string | undefined {
  const row = db()
    .prepare(`SELECT in_group_id FROM in_group_dids WHERE did = ?`)
    .get(did) as { in_group_id: string } | undefined;
  return row?.in_group_id;
}

export function attachDidToInGroup(inGroupId: string, did: string): void {
  db()
    .prepare(
      `INSERT INTO in_group_dids (in_group_id, did) VALUES (?, ?)`,
    )
    .run(inGroupId, did);
}

export function detachDidFromInGroup(inGroupId: string, did: string): boolean {
  const result = db()
    .prepare(
      `DELETE FROM in_group_dids WHERE in_group_id = ? AND did = ?`,
    )
    .run(inGroupId, did);
  return Number(result.changes) > 0;
}

// =====================================================================
// campaigns
// =====================================================================

export interface CampaignRecord {
  id: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  route_plan_id: string;
  base_ratio: number;
  call_window_start: string | null;
  call_window_end: string | null;
  max_abandon_pct: number;
  created_at: string;
  updated_at: string;
}

export function insertCampaign(rec: {
  id: string;
  name: string;
  description: string | null;
  type: string;
  route_plan_id: string;
  base_ratio: number;
  call_window_start: string | null;
  call_window_end: string | null;
  max_abandon_pct: number;
}): void {
  db()
    .prepare(
      `INSERT INTO campaigns (
        id, name, description, type, route_plan_id,
        base_ratio, call_window_start, call_window_end, max_abandon_pct
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.id,
      rec.name,
      rec.description,
      rec.type,
      rec.route_plan_id,
      rec.base_ratio,
      rec.call_window_start,
      rec.call_window_end,
      rec.max_abandon_pct,
    );
}

export function attachCampaignLeadLists(
  campaignId: string,
  leadListIds: string[],
): void {
  if (leadListIds.length === 0) return;
  const stmt = db().prepare(
    `INSERT OR IGNORE INTO campaign_lead_lists (campaign_id, lead_list_id, priority) VALUES (?, ?, ?)`,
  );
  for (let i = 0; i < leadListIds.length; i++) {
    stmt.run(campaignId, leadListIds[i]!, i);
  }
}

export function listCampaignsFromDb(): CampaignRecord[] {
  return db()
    .prepare(`SELECT * FROM campaigns ORDER BY created_at DESC`)
    .all() as unknown as CampaignRecord[];
}

export function getCampaignFromDb(id: string): CampaignRecord | undefined {
  return db()
    .prepare(`SELECT * FROM campaigns WHERE id = ?`)
    .get(id) as unknown as CampaignRecord | undefined;
}

export function deleteCampaignFromDb(id: string): boolean {
  const result = db().prepare(`DELETE FROM campaigns WHERE id = ?`).run(id);
  return Number(result.changes) > 0;
}

export function updateCampaignStatusInDb(
  id: string,
  status: string,
): boolean {
  const result = db()
    .prepare(
      `UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .run(status, id);
  return Number(result.changes) > 0;
}

export function updateCampaignFields(
  id: string,
  updates: Partial<{
    name: string;
    description: string | null;
    type: string;
    base_ratio: number;
    call_window_start: string | null;
    call_window_end: string | null;
    max_abandon_pct: number;
  }>,
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    values.push(value as string | number | null);
  }
  if (fields.length === 0) return false;
  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);
  const result = db()
    .prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]));
  return Number(result.changes) > 0;
}

export function updateRoutePlanFields(
  id: string,
  updates: Partial<{
    name: string;
    description: string | null;
    failover_carrier_ids_json: string;
    cid_strategy: string;
    cid_single: string | null;
    cid_pool_json: string;
    transform_strip_prefix: string | null;
    transform_add_prefix: string | null;
    enabled: boolean;
  }>,
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    if (key === 'enabled') values.push(value ? 1 : 0);
    else values.push(value as string | null);
  }
  if (fields.length === 0) return false;
  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);
  const result = db()
    .prepare(`UPDATE route_plans SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]));
  return Number(result.changes) > 0;
}

export function updateInGroupFields(
  id: string,
  updates: Partial<{
    name: string;
    description: string | null;
    type: string;
    whitelist_mode: string;
    whitelist_static_json: string;
    routing_strategy: string;
    max_wait_seconds: number;
    wrap_up_seconds: number;
    off_list_action: string;
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
    .prepare(`UPDATE in_groups SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]));
  return Number(result.changes) > 0;
}

export function getCampaignLeadListIds(campaignId: string): string[] {
  const rows = db()
    .prepare(
      `SELECT lead_list_id FROM campaign_lead_lists WHERE campaign_id = ? ORDER BY priority ASC`,
    )
    .all(campaignId) as Array<{ lead_list_id: string }>;
  return rows.map((r) => r.lead_list_id);
}

export function listCampaignsUsingRoutePlan(
  routePlanId: string,
): CampaignRecord[] {
  return db()
    .prepare(
      `SELECT * FROM campaigns WHERE route_plan_id = ? ORDER BY created_at DESC`,
    )
    .all(routePlanId) as unknown as CampaignRecord[];
}

export function listCampaignsUsingLeadList(
  leadListId: string,
): CampaignRecord[] {
  return db()
    .prepare(
      `SELECT c.* FROM campaigns c
       JOIN campaign_lead_lists cll ON cll.campaign_id = c.id
       WHERE cll.lead_list_id = ?
       ORDER BY c.created_at DESC`,
    )
    .all(leadListId) as unknown as CampaignRecord[];
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
