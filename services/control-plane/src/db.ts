import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import type { NodeRecord, NodeRole, NodeStatus } from './schema';
import { COLUMN_MIGRATIONS, CREATE_TABLES_SQL } from './db-schema';
// iter 134 — recommendDialLevel reads admin-tunable thresholds.
import { getPacingThresholds } from './app-settings';

// iter 130 webpack workaround: node:sqlite has no bare-name
// equivalent (the builtin only exists under the node: scheme),
// and webpack 5 errors on the node: prefix when transpiling
// this file for non-Node targets (edge bundle that Next builds
// for middleware, client bundle that gets pulled in via
// transpilePackages). Using createRequire from the standard
// 'module' builtin sidesteps webpack's static analysis of
// import specifiers: createRequire(...)('node:sqlite') is a
// runtime call webpack treats as opaque.
//
// On Node server (the only place this file actually executes),
// createRequire from 'module' works in both CJS and ESM
// emission modes. For the client + edge bundles, next.config's
// resolve.fallback maps 'module' → false so the build doesn't
// try to follow this import.
import { createRequire } from 'module';
type SqliteRow = Record<string, unknown>;
type SqliteStmt = {
  run: (...args: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint };
  get: (...args: unknown[]) => SqliteRow | undefined;
  all: (...args: unknown[]) => SqliteRow[];
};
interface DatabaseSync {
  prepare(sql: string): SqliteStmt;
  exec(sql: string): void;
}
const _require = createRequire(import.meta.url) as (
  m: string,
) => { DatabaseSync: new (path: string) => DatabaseSync };
const { DatabaseSync } = _require('node:sqlite');

const DB_PATH =
  process.env.DIALEROS_DB ?? resolve(process.cwd(), 'data', 'dialeros.db');

let _db: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (_db) return _db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const d = new DatabaseSync(DB_PATH);
  d.exec('PRAGMA journal_mode = WAL');
  d.exec('PRAGMA foreign_keys = ON');
  // Iter 111 — schema declarations live in db-schema.ts.
  d.exec(CREATE_TABLES_SQL);

  // Idempotent ALTERs — sqlite has no IF NOT EXISTS for columns. We
  // try each one; "duplicate column name" errors mean it's already
  // applied (harmless). Any other error gets propagated.
  // Iter 111 — migrations list lives in db-schema.ts.
  const migrations = COLUMN_MIGRATIONS;
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

  // Iter 23 backfill — copy each list's first attached campaign (if any)
  // into the new column. Idempotent: only fills NULLs, so repeat startups
  // are no-ops. Picks the lowest-priority entry to break ties deterministically.
  d.exec(`
    UPDATE lead_lists
       SET campaign_id = (
         SELECT campaign_id FROM campaign_lead_lists cll
          WHERE cll.lead_list_id = lead_lists.id
          ORDER BY cll.priority ASC, cll.campaign_id ASC
          LIMIT 1
       )
     WHERE campaign_id IS NULL
  `);

  d.exec(
    `CREATE INDEX IF NOT EXISTS idx_lead_lists_campaign ON lead_lists(campaign_id)`,
  );

  // Iter 61 backfill — populate nodes.roles from the legacy single-
  // role column wherever roles is still NULL. Idempotent because
  // the WHERE guard skips rows that already have a roles array.
  d.exec(
    `UPDATE nodes
        SET roles = json_array(role)
      WHERE roles IS NULL`,
  );

  // Iter 74 backfill — populate route_plan_carriers from the legacy
  // primary_carrier_id + failover_carrier_ids_json wherever the plan
  // has no rows yet. Primary lands at priority 1; failovers land at
  // 2, 3, ... in the order the JSON array stored them. Idempotent
  // because the NOT EXISTS guard skips plans that already have rows.
  backfillRoutePlanCarriers(d);

  _db = d;
  return d;
}

function backfillRoutePlanCarriers(d: DatabaseSync): void {
  const plans = d
    .prepare(
      `SELECT id, primary_carrier_id, failover_carrier_ids_json
         FROM route_plans
        WHERE NOT EXISTS (
          SELECT 1 FROM route_plan_carriers rpc
           WHERE rpc.route_plan_id = route_plans.id
        )`,
    )
    .all() as Array<{
    id: string;
    primary_carrier_id: string;
    failover_carrier_ids_json: string;
  }>;
  if (plans.length === 0) return;

  const insert = d.prepare(
    `INSERT INTO route_plan_carriers
       (id, route_plan_id, carrier_id, priority, ports)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(route_plan_id, carrier_id) DO NOTHING`,
  );
  d.exec('BEGIN');
  try {
    for (const p of plans) {
      // Primary at priority 1.
      insert.run(randomUUID(), p.id, p.primary_carrier_id, 1, 30);
      // Failovers at priority 2..N. Skip the primary if it accidentally
      // appears in the failover array too.
      let failovers: string[] = [];
      try {
        const parsed = JSON.parse(p.failover_carrier_ids_json);
        if (Array.isArray(parsed)) {
          failovers = parsed.filter(
            (s): s is string =>
              typeof s === 'string' && s !== p.primary_carrier_id,
          );
        }
      } catch {
        // ignore malformed JSON; treat as no failovers
      }
      failovers.forEach((cid, idx) => {
        insert.run(randomUUID(), p.id, cid, 2 + idx, 30);
      });
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
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
  roles?: NodeRole[];
  is_self?: boolean;
  status?: NodeStatus;
}): void {
  // Iter 61 — both `role` (legacy single) and `roles` (JSON array)
  // get written. roles defaults to [role] so back-compat tooling
  // that still reads `role` keeps working.
  const rolesArr = rec.roles && rec.roles.length > 0 ? rec.roles : [rec.role];
  db()
    .prepare(
      `INSERT INTO nodes (id, name, host, port, ssh_user, role, roles, is_self, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.id,
      rec.name,
      rec.host,
      rec.port,
      rec.ssh_user,
      rec.role,
      JSON.stringify(rolesArr),
      rec.is_self ? 1 : 0,
      rec.status ?? 'PROVISIONING',
    );
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

/**
 * Iter 61 — overwrite a node's roles array. Also keeps the legacy
 * `role` column pointing at the first entry so any unmigrated reader
 * sees a sensible value.
 */
export function updateNodeRoles(id: string, roles: NodeRole[]): boolean {
  if (roles.length === 0) return false;
  const result = db()
    .prepare(
      `UPDATE nodes SET roles = ?, role = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .run(JSON.stringify(roles), roles[0]!, id);
  return Number(result.changes) > 0;
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

/** Iter 61 — read the JSON-encoded roles column safely. */
export function parseNodeRoles(node: NodeRecord): NodeRole[] {
  if (node.roles) {
    try {
      const arr = JSON.parse(node.roles);
      if (Array.isArray(arr)) {
        return arr.filter(
          (r): r is NodeRole =>
            r === 'telephony' ||
            r === 'web' ||
            r === 'database' ||
            r === 'ai-worker',
        );
      }
    } catch {
      /* fall through to legacy single role */
    }
  }
  return [node.role];
}

export function nodeHasRole(node: NodeRecord, role: NodeRole): boolean {
  return parseNodeRoles(node).includes(role);
}

export function findNodeByHost(host: string): NodeRecord | undefined {
  return db()
    .prepare(`SELECT * FROM nodes WHERE host = ? LIMIT 1`)
    .get(host) as unknown as NodeRecord | undefined;
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
  manual_dial: number;
  permissions: string | null;
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
    manual_dial: boolean;
    permissions: string | null;
  }>,
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    if (key === 'is_active' || key === 'manual_dial') values.push(value ? 1 : 0);
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

/** Iter 76 — filtered audit query.
 * - actionPrefix: 'campaign.' matches every campaign.* event.
 * - actorUserId: restrict to one actor.
 * - targetType: restrict to one resource kind.
 * - beforeTs / afterTs: pagination cursor (ISO timestamps from the row's
 *   `ts`). Note: ts has millisecond precision so 2 rows in the same ms
 *   could in theory tie; the (ts DESC, id DESC) tiebreak below keeps
 *   ordering deterministic.
 * Returns at most `limit` rows in descending time order. */
export function listAuditEventsFiltered(opts: {
  limit?: number;
  actionPrefix?: string | null;
  actorUserId?: string | null;
  targetType?: string | null;
  beforeTs?: string | null;
  afterTs?: string | null;
}): AuditEventRecord[] {
  const where: string[] = [];
  const values: unknown[] = [];
  if (opts.actionPrefix) {
    where.push(`action LIKE ?`);
    values.push(opts.actionPrefix.endsWith('%')
      ? opts.actionPrefix
      : `${opts.actionPrefix}%`);
  }
  if (opts.actorUserId) {
    where.push(`actor_user_id = ?`);
    values.push(opts.actorUserId);
  }
  if (opts.targetType) {
    where.push(`target_type = ?`);
    values.push(opts.targetType);
  }
  if (opts.beforeTs) {
    where.push(`ts < ?`);
    values.push(opts.beforeTs);
  }
  if (opts.afterTs) {
    where.push(`ts > ?`);
    values.push(opts.afterTs);
  }
  const sql =
    `SELECT * FROM audit_events` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY ts DESC, id DESC LIMIT ?`;
  values.push(opts.limit ?? 50);
  return db()
    .prepare(sql)
    .all(...(values as never[])) as unknown as AuditEventRecord[];
}

/** Iter 76 — list distinct target_types from audit_events for filter
 * dropdowns. Cheap query because of the existing
 * idx_audit_target(target_type, target_id) index. */
export function listAuditTargetTypes(): string[] {
  const rows = db()
    .prepare(
      `SELECT DISTINCT target_type FROM audit_events
        WHERE target_type IS NOT NULL
        ORDER BY target_type ASC`,
    )
    .all() as Array<{ target_type: string }>;
  return rows.map((r) => r.target_type);
}

// =====================================================================
// reports — aggregate queries for the /reports dashboard (iter 15)
// =====================================================================

export function dialIntentsByHour(
  sinceIso: string,
): Array<{ hour: string; count: number }> {
  return db()
    .prepare(
      `SELECT substr(ts, 1, 13) AS hour, COUNT(*) AS count
       FROM dial_intents
       WHERE ts >= ?
       GROUP BY hour
       ORDER BY hour ASC`,
    )
    .all(sinceIso) as unknown as Array<{ hour: string; count: number }>;
}

export function totalDialIntents(sinceIso: string): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM dial_intents WHERE ts >= ?`)
    .get(sinceIso) as { n: number };
  return row.n;
}

export function globalLeadStatusBreakdown(): Array<{
  status: string;
  count: number;
}> {
  return db()
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM leads
       GROUP BY status
       ORDER BY count DESC`,
    )
    .all() as unknown as Array<{ status: string; count: number }>;
}

export function topCampaignsByIntents(
  sinceIso: string,
  limit: number,
): Array<{
  campaign_id: string;
  name: string;
  status: string;
  intents: number;
}> {
  return db()
    .prepare(
      `SELECT c.id AS campaign_id, c.name, c.status,
              COALESCE(SUM(CASE WHEN di.ts >= ? THEN 1 ELSE 0 END), 0) AS intents
       FROM campaigns c
       LEFT JOIN dial_intents di ON di.campaign_id = c.id
       GROUP BY c.id
       ORDER BY intents DESC, c.name ASC
       LIMIT ?`,
    )
    .all(sinceIso, limit) as unknown as Array<{
    campaign_id: string;
    name: string;
    status: string;
    intents: number;
  }>;
}

export function auditCountsByAction(
  sinceIso: string,
): Array<{ action: string; count: number }> {
  return db()
    .prepare(
      `SELECT action, COUNT(*) AS count
       FROM audit_events
       WHERE ts >= ?
       GROUP BY action
       ORDER BY count DESC`,
    )
    .all(sinceIso) as unknown as Array<{ action: string; count: number }>;
}

export function loginActivityRollup(
  sinceIso: string,
): Array<{ username: string; success: number; failure: number }> {
  // SQLite refuses ORDER BY (success + failure) directly after a UNION
  // because the ORDER BY can't see "across" the union legs. Wrap in an
  // outer SELECT and order there.
  return db()
    .prepare(
      `SELECT * FROM (
         WITH succ AS (
           SELECT COALESCE(json_extract(payload_json, '$.username'), '?') AS username,
                  COUNT(*) AS n
           FROM audit_events
           WHERE ts >= ? AND action = 'user.login_success'
           GROUP BY username
         ),
         fail AS (
           SELECT COALESCE(json_extract(payload_json, '$.username'), '?') AS username,
                  COUNT(*) AS n
           FROM audit_events
           WHERE ts >= ? AND action = 'user.login_failure'
           GROUP BY username
         )
         SELECT
           COALESCE(succ.username, fail.username) AS username,
           COALESCE(succ.n, 0) AS success,
           COALESCE(fail.n, 0) AS failure
         FROM succ
         LEFT JOIN fail ON fail.username = succ.username
         UNION
         SELECT
           fail.username AS username,
           COALESCE(succ.n, 0) AS success,
           fail.n AS failure
         FROM fail
         LEFT JOIN succ ON succ.username = fail.username
       )
       ORDER BY (success + failure) DESC, username ASC`,
    )
    .all(sinceIso, sinceIso) as unknown as Array<{
    username: string;
    success: number;
    failure: number;
  }>;
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
  dial_prefixes: string | null;
  dial_plan_rules: string | null;
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
    dial_prefixes: string | null;
    dial_plan_rules: string | null;
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
  /** Iter 72 — JSON array of cid_groups.id attached to this plan. */
  cid_group_ids_json: string;
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
  cid_group_ids_json: string;
  transform_strip_prefix: string | null;
  transform_add_prefix: string | null;
  enabled: boolean;
}): void {
  db()
    .prepare(
      `INSERT INTO route_plans (
        id, name, description, primary_carrier_id, failover_carrier_ids_json,
        cid_strategy, cid_single, cid_pool_json, cid_group_ids_json,
        transform_strip_prefix, transform_add_prefix, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      rec.cid_group_ids_json,
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
// route_plan_carriers (iter 74) — many-to-many carriers per plan with
// priority + port allocation.
// =====================================================================

export interface RoutePlanCarrierRecord {
  id: string;
  route_plan_id: string;
  carrier_id: string;
  priority: number;
  ports: number;
  created_at: string;
}

export function listCarriersForRoutePlanFromDb(
  planId: string,
): RoutePlanCarrierRecord[] {
  return db()
    .prepare(
      `SELECT * FROM route_plan_carriers
        WHERE route_plan_id = ?
        ORDER BY priority ASC, created_at ASC, carrier_id ASC`,
    )
    .all(planId) as unknown as RoutePlanCarrierRecord[];
}

/** Full-set replace. Wipes the plan's existing rows and inserts the
 * given carriers in a single transaction. Caller is expected to have
 * already validated that every carrier_id exists and that the array
 * has no duplicates. Returns the count of rows inserted. */
export function replaceRoutePlanCarriers(
  planId: string,
  rows: Array<{ carrier_id: string; priority: number; ports: number }>,
): number {
  const d = db();
  const del = d.prepare(
    `DELETE FROM route_plan_carriers WHERE route_plan_id = ?`,
  );
  const ins = d.prepare(
    `INSERT INTO route_plan_carriers
       (id, route_plan_id, carrier_id, priority, ports)
     VALUES (?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  d.exec('BEGIN');
  try {
    del.run(planId);
    for (const r of rows) {
      ins.run(randomUUID(), planId, r.carrier_id, r.priority, r.ports);
      inserted++;
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return inserted;
}

/** In-flight (un-hung-up) call count for a carrier across ALL route
 * plans. Used by the pacer's port-cap gate. */
export function inFlightForCarrier(carrierId: string): number {
  // Iter 77 — only real calls occupy a real trunk port. Simulated
  // ticks write dial_intent rows for visibility but never go to FS,
  // so they have no FS event flow to ever set hangup_at. Counting
  // them would permanently inflate the port-cap gauge.
  // Iter 81 — fix: previously this filtered `kind = 'live'`, but the
  // pacer never writes that value — it writes 'originating' (pre-bgapi
  // placeholder, iter 79), 'originated' (bgapi succeeded), or
  // 'originate_failed'. The wrong filter meant in-flight was always
  // 0, port cap never enforced, calls piled up on the trunk regardless
  // of the configured ports value. Use `!= 'simulated'` so every real
  // kind counts.
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM dial_intents
        WHERE carrier_id = ?
          AND hangup_at IS NULL
          AND kind != 'simulated'`,
    )
    .get(carrierId) as { n: number };
  return Number(row.n);
}

// =====================================================================
// cid groups (iter 72)
// =====================================================================

export interface CidGroupRecord {
  id: string;
  name: string;
  description: string | null;
  strategy: string;
  created_at: string;
  updated_at: string;
}

export interface CidGroupNumberRecord {
  id: string;
  group_id: string;
  number: string;
  created_at: string;
}

export function insertCidGroup(rec: {
  id: string;
  name: string;
  description: string | null;
  strategy: string;
}): void {
  db()
    .prepare(
      `INSERT INTO cid_groups (id, name, description, strategy)
       VALUES (?, ?, ?, ?)`,
    )
    .run(rec.id, rec.name, rec.description, rec.strategy);
}

export function listCidGroupsFromDb(): CidGroupRecord[] {
  return db()
    .prepare(`SELECT * FROM cid_groups ORDER BY name ASC`)
    .all() as unknown as CidGroupRecord[];
}

export function getCidGroupFromDb(id: string): CidGroupRecord | undefined {
  return db()
    .prepare(`SELECT * FROM cid_groups WHERE id = ?`)
    .get(id) as unknown as CidGroupRecord | undefined;
}

export function deleteCidGroupFromDb(id: string): boolean {
  const result = db().prepare(`DELETE FROM cid_groups WHERE id = ?`).run(id);
  return Number(result.changes) > 0;
}

export function updateCidGroupFields(
  id: string,
  updates: Partial<{
    name: string;
    description: string | null;
    strategy: string;
  }>,
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return false;
  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);
  const result = db()
    .prepare(`UPDATE cid_groups SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]));
  return Number(result.changes) > 0;
}

export function listCidsInGroupFromDb(groupId: string): CidGroupNumberRecord[] {
  return db()
    .prepare(
      `SELECT * FROM cid_group_numbers WHERE group_id = ? ORDER BY created_at ASC, number ASC`,
    )
    .all(groupId) as unknown as CidGroupNumberRecord[];
}

export function countCidsInGroupFromDb(groupId: string): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM cid_group_numbers WHERE group_id = ?`)
    .get(groupId) as { n: number };
  return Number(row.n);
}

/** Bulk insert. Each row gets a fresh uuid. ON CONFLICT (group_id, number)
 * silently no-ops so re-uploading the same list is idempotent. Returns
 * the count of rows actually inserted. */
export function bulkInsertCidGroupNumbers(
  groupId: string,
  rows: Array<{ id: string; number: string }>,
): number {
  if (rows.length === 0) return 0;
  const d = db();
  const stmt = d.prepare(
    `INSERT INTO cid_group_numbers (id, group_id, number)
     VALUES (?, ?, ?)
     ON CONFLICT(group_id, number) DO NOTHING`,
  );
  let inserted = 0;
  d.exec('BEGIN');
  try {
    for (const r of rows) {
      const res = stmt.run(r.id, groupId, r.number);
      inserted += Number(res.changes);
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return inserted;
}

export function deleteCidGroupNumberFromDb(numberId: string): boolean {
  const result = db()
    .prepare(`DELETE FROM cid_group_numbers WHERE id = ?`)
    .run(numberId);
  return Number(result.changes) > 0;
}

/** Returns the route plans that currently reference the given cid group,
 * by scanning route_plans.cid_group_ids_json for the id. */
export function listRoutePlansUsingCidGroup(groupId: string): RoutePlanRecord[] {
  return db()
    .prepare(
      `SELECT * FROM route_plans
        WHERE cid_group_ids_json LIKE '%' || ? || '%'
        ORDER BY name ASC`,
    )
    .all(groupId) as unknown as RoutePlanRecord[];
}

// =====================================================================
// lead lists + leads
// =====================================================================

export interface LeadListRecord {
  id: string;
  name: string;
  description: string | null;
  status: string;
  campaign_id: string | null;
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
  /** Iter 91 — inferred timezone from phone area code. NULL until
   * the backfill pass (or CSV ingest) populates it. */
  timezone: string | null;
  /** Iter 125 — per-lead caller-ID override. NULL falls through
   * to the route plan's cid_strategy. */
  preferred_cid: string | null;
  created_at: string;
  updated_at: string;
}

export function insertLeadList(rec: {
  id: string;
  name: string;
  description: string | null;
  campaign_id?: string | null;
}): void {
  db()
    .prepare(
      `INSERT INTO lead_lists (id, name, description, campaign_id) VALUES (?, ?, ?, ?)`,
    )
    .run(rec.id, rec.name, rec.description, rec.campaign_id ?? null);
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

export function updateLeadListFields(
  id: string,
  updates: Partial<{
    name: string;
    description: string | null;
  }>,
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    values.push(value as string | null);
  }
  if (fields.length === 0) return false;
  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);
  const result = db()
    .prepare(`UPDATE lead_lists SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]));
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

/**
 * Iter 60 — bucket a list's leads by inferred timezone (from the
 * phone number). Returns the rows ordered by descending count so
 * the UI's "where is the biggest chunk of this list right now?"
 * question is answered top-to-bottom.
 */
export function leadListTimezoneBreakdown(
  listId: string,
  infer: (phone: string) => string | null,
): Array<{ tz: string; count: number }> {
  const rows = db()
    .prepare(`SELECT phone FROM leads WHERE list_id = ?`)
    .all(listId) as Array<{ phone: string }>;
  const buckets = new Map<string, number>();
  for (const r of rows) {
    const tz = infer(r.phone) ?? '—';
    buckets.set(tz, (buckets.get(tz) ?? 0) + 1);
  }
  return Array.from(buckets, ([tz, count]) => ({ tz, count })).sort(
    (a, b) => b.count - a.count,
  );
}

export function leadStatusBreakdown(listId: string): LeadStatusBreakdown[] {
  return db()
    .prepare(
      `SELECT status, COUNT(*) AS count FROM leads WHERE list_id = ? GROUP BY status ORDER BY count DESC`,
    )
    .all(listId) as unknown as LeadStatusBreakdown[];
}

/** Iter 92 — single-lead lookups + edits for the per-lead detail
 * page. Returns the same row shape as listLeadsInList. */
export function getLeadById(id: string): LeadRecord | undefined {
  return db()
    .prepare(`SELECT * FROM leads WHERE id = ?`)
    .get(id) as unknown as LeadRecord | undefined;
}

/** Iter 93 — find an existing lead by exact phone match, optionally
 * scoped to a set of lead lists. Used by the manual-dial path to
 * attribute the call to the right lead when one exists in the
 * agent's campaign lists. Returns undefined when nothing matches. */
export function findLeadByPhone(
  phone: string,
  listIds?: string[],
): LeadRecord | undefined {
  if (listIds && listIds.length === 0) return undefined;
  if (!listIds || listIds.length === 0) {
    return db()
      .prepare(`SELECT * FROM leads WHERE phone = ? LIMIT 1`)
      .get(phone) as unknown as LeadRecord | undefined;
  }
  const placeholders = listIds.map(() => '?').join(',');
  return db()
    .prepare(
      `SELECT * FROM leads
        WHERE phone = ? AND list_id IN (${placeholders})
        LIMIT 1`,
    )
    .get(phone, ...listIds) as unknown as LeadRecord | undefined;
}

/** Iter 93 — single-row lead insert. Returns the inserted row id,
 * or null when a duplicate (phone, list_id) silently no-ops via
 * the UNIQUE index. Used by the manual-dial path to drop a
 * synthetic lead into the campaign's first attached list when no
 * existing lead matches the dialed number. */
export function insertSingleLead(rec: {
  id: string;
  list_id: string;
  phone: string;
  name: string | null;
  email: string | null;
  timezone?: string | null;
  status?: string;
}): string | null {
  const result = db()
    .prepare(
      `INSERT OR IGNORE INTO leads (id, list_id, phone, name, email, timezone, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.id,
      rec.list_id,
      rec.phone,
      rec.name,
      rec.email,
      rec.timezone ?? null,
      rec.status ?? 'NEW',
    );
  return Number(result.changes) > 0 ? rec.id : null;
}

/** Iter 92 — full call history for one lead. dial_intents joined
 * with the route plan + carrier names for display. Ordered most-
 * recent first because the operator usually wants to see the
 * latest attempts at the top. Excludes simulated rows. */
export interface LeadCallHistoryRow {
  id: number;
  ts: string;
  campaign_id: string;
  campaign_name: string;
  route_plan_id: string;
  route_plan_name: string | null;
  carrier_id: string | null;
  carrier_name: string | null;
  cid_used: string | null;
  kind: string;
  answered_at: string | null;
  hangup_at: string | null;
  hangup_cause: string | null;
  duration_ms: number | null;
  originate_error: string | null;
  recording_path: string | null;
  // Iter 135 — AI-pipeline outputs (populated by the operator's
  // worker that polls /api/internal/ai-pending). NULL until the
  // worker writes back through /api/internal/ai-process.
  transcript_text: string | null;
  ai_summary: string | null;
  ai_processed_at: string | null;
  ai_sentiment: string | null;
  ai_flags: string | null;
}

export function listCallHistoryForLead(
  leadId: string,
  limit = 50,
): LeadCallHistoryRow[] {
  return db()
    .prepare(
      `SELECT
         di.id, di.ts,
         di.campaign_id, c.name AS campaign_name,
         di.route_plan_id, rp.name AS route_plan_name,
         di.carrier_id, ca.name AS carrier_name,
         di.cid_used, di.kind,
         di.answered_at, di.hangup_at, di.hangup_cause,
         di.duration_ms, di.originate_error, di.recording_path,
         di.transcript_text, di.ai_summary, di.ai_processed_at,
         di.ai_sentiment, di.ai_flags
       FROM dial_intents di
       JOIN campaigns c ON c.id = di.campaign_id
       LEFT JOIN route_plans rp ON rp.id = di.route_plan_id
       LEFT JOIN carriers ca ON ca.id = di.carrier_id
       WHERE di.lead_id = ?
         AND di.kind != 'simulated'
       ORDER BY di.id DESC
       LIMIT ?`,
    )
    .all(leadId, limit) as unknown as LeadCallHistoryRow[];
}

/** Iter 92 — partial update on a lead row. Only the operator-
 * editable fields are mutable; phone is intentionally locked
 * (changing it would invalidate the inferred timezone + DNC
 * matching + call history correlation). */
export function updateLeadFields(
  id: string,
  updates: Partial<{
    name: string | null;
    email: string | null;
    status: string;
    callback_at: string | null;
    timezone: string | null;
    preferred_cid: string | null;
  }>,
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return false;
  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);
  const result = db()
    .prepare(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]));
  return Number(result.changes) > 0;
}

/** Iter 92 — hard-delete one lead. The CASCADE on dial_intents
 * (set up in the schema) will sweep the call history too. */
export function deleteLeadFromDb(id: string): boolean {
  const result = db().prepare(`DELETE FROM leads WHERE id = ?`).run(id);
  return Number(result.changes) > 0;
}

/** Iter 91 — return leads whose `timezone` column is still NULL,
 * so a startup pass can fill it in via inferLeadTimezone(phone).
 * The pacer module owns the actual backfill loop because db.ts
 * can't import from timezones.ts without a circular ref. */
export function listLeadsWithoutTimezone(
  limit = 500,
): Array<{ id: string; phone: string }> {
  return db()
    .prepare(
      `SELECT id, phone FROM leads
        WHERE timezone IS NULL
        LIMIT ?`,
    )
    .all(limit) as unknown as Array<{ id: string; phone: string }>;
}

/** Iter 91 — patch the inferred timezone onto a lead row.
 * Called both at startup (backfill) and during CSV ingest. */
export function setLeadTimezone(leadId: string, timezone: string | null): void {
  db()
    .prepare(`UPDATE leads SET timezone = ? WHERE id = ?`)
    .run(timezone, leadId);
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

/** Iter 127 — phones-only projection for in-memory dedupe during
 * CSV ingest. Avoids N+1 findLeadByPhone calls on big imports
 * (10k rows → 10k queries → ~seconds in dev). Single indexed
 * scan of a single column is sub-100ms even on 100k-lead lists. */
export function listLeadPhonesInList(listId: string): string[] {
  const rows = db()
    .prepare(`SELECT phone FROM leads WHERE list_id = ?`)
    .all(listId) as Array<{ phone: string }>;
  return rows.map((r) => r.phone);
}

export interface LeadFilterOpts {
  status?: string | null;
  search?: string | null; // matches phone OR name OR email substring
  limit?: number;
  offset?: number;
}

function buildLeadFilterWhere(
  listId: string,
  opts: LeadFilterOpts,
): { sql: string; values: unknown[] } {
  const where: string[] = ['list_id = ?'];
  const values: unknown[] = [listId];
  if (opts.status) {
    where.push('status = ?');
    values.push(opts.status);
  }
  if (opts.search && opts.search.trim()) {
    const pat = `%${opts.search.trim()}%`;
    where.push('(phone LIKE ? OR name LIKE ? OR email LIKE ?)');
    values.push(pat, pat, pat);
  }
  return { sql: where.join(' AND '), values };
}

/** Iter 80 — paginated + filterable leads view backing the
 * drill-down on the lead list page. Index on (list_id, status)
 * (already exists for the leadStatusBreakdown query) keeps the
 * status filter fast; search uses LIKE so it scales linearly with
 * list size, fine for lists up to ~100K. */
export function listLeadsFiltered(
  listId: string,
  opts: LeadFilterOpts,
): LeadRecord[] {
  const { sql: where, values } = buildLeadFilterWhere(listId, opts);
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  return db()
    .prepare(
      `SELECT * FROM leads
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...(values as never[]), limit, offset) as unknown as LeadRecord[];
}

export function countLeadsFiltered(
  listId: string,
  opts: LeadFilterOpts,
): number {
  const { sql: where, values } = buildLeadFilterWhere(listId, opts);
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM leads WHERE ${where}`)
    .get(...(values as never[])) as { n: number };
  return Number(row.n);
}

/** Iter 80 — hangup-cause distribution for leads in this list.
 * Joins dial_intents → leads and counts each lead by its MOST RECENT
 * dial_intent's hangup_cause. Excludes simulated rows and rows that
 * haven't hung up yet. Null causes (in-flight) reported as 'IN_FLIGHT'
 * separately so the operator sees "still ringing" calls. */
export function leadHangupCauseBreakdown(
  listId: string,
): Array<{ cause: string; count: number }> {
  return db()
    .prepare(
      `WITH latest AS (
         SELECT di.lead_id,
                di.hangup_cause,
                di.hangup_at,
                di.kind,
                ROW_NUMBER() OVER (
                  PARTITION BY di.lead_id ORDER BY di.id DESC
                ) AS rn
           FROM dial_intents di
           JOIN leads l ON l.id = di.lead_id
          WHERE l.list_id = ?
            AND di.kind != 'simulated'
       )
       SELECT
         CASE
           WHEN hangup_cause IS NOT NULL THEN hangup_cause
           ELSE 'IN_FLIGHT'
         END AS cause,
         COUNT(*) AS count
       FROM latest
       WHERE rn = 1
       GROUP BY cause
       ORDER BY count DESC`,
    )
    .all(listId) as unknown as Array<{ cause: string; count: number }>;
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
    /** Iter 91 — optional inferred TZ. lead.ts ingestCsv populates
     * it via inferLeadTimezone(phone) on each row so the column is
     * filled at insert time instead of waiting for the next
     * startup backfill pass. */
    timezone?: string | null;
  }>,
): { inserted: number; skipped: number } {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };
  const d = db();
  const stmt = d.prepare(
    `INSERT OR IGNORE INTO leads (id, list_id, phone, name, email, timezone) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  d.exec('BEGIN');
  try {
    for (const r of rows) {
      const result = stmt.run(
        r.id,
        r.list_id,
        r.phone,
        r.name,
        r.email,
        r.timezone ?? null,
      );
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
// app settings (iter 28)
// =====================================================================

export function setAppSettingEncrypted(key: string, envelope: string): void {
  db()
    .prepare(
      `INSERT INTO app_settings (key, value_encrypted, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value_encrypted = excluded.value_encrypted,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .run(key, envelope);
}

export function getAppSettingEncrypted(key: string): string | undefined {
  const row = db()
    .prepare(`SELECT value_encrypted FROM app_settings WHERE key = ?`)
    .get(key) as { value_encrypted: string } | undefined;
  return row?.value_encrypted;
}

export function deleteAppSetting(key: string): boolean {
  const result = db().prepare(`DELETE FROM app_settings WHERE key = ?`).run(key);
  return Number(result.changes) > 0;
}

export function appSettingExists(key: string): boolean {
  const row = db()
    .prepare(`SELECT 1 AS x FROM app_settings WHERE key = ?`)
    .get(key) as { x: number } | undefined;
  return !!row;
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
  assigned_user_id: string | null;
  disposition: string | null;
  dispositioned_at: string | null;
  callback_at: string | null;
  call_uuid: string | null;
  originate_error: string | null;
  correlation_id: string | null;
  hangup_cause: string | null;
  answered_at: string | null;
  hangup_at: string | null;
  duration_ms: number | null;
  recording_path: string | null;
  remote_agent_id: string | null;
  // Iter 122 — amd_v2 verdict (HUMAN/MACHINE/NOTSURE/UNKNOWN)
  amd_result: string | null;
  // Iter 135 — AI worker outputs
  transcript_text: string | null;
  ai_summary: string | null;
  ai_processed_at: string | null;
  ai_sentiment: string | null;
  ai_flags: string | null;
  // Iter 124 — carrier the call routed through
  carrier_id: string | null;
  // Iter 146 — auto vs agent disposition
  disposition_origin: string | null;
}

export function insertDialIntent(rec: {
  campaign_id: string;
  lead_id: string;
  route_plan_id: string;
  phone: string;
  transformed_phone: string;
  cid_used: string | null;
  kind?: string;
  assigned_user_id?: string | null;
  call_uuid?: string | null;
  originate_error?: string | null;
  correlation_id?: string | null;
  recording_path?: string | null;
  remote_agent_id?: string | null;
  carrier_id?: string | null;
}): DialIntentRecord {
  const result = db()
    .prepare(
      `INSERT INTO dial_intents
         (campaign_id, lead_id, route_plan_id, phone, transformed_phone, cid_used, kind, assigned_user_id, call_uuid, originate_error, correlation_id, recording_path, remote_agent_id, carrier_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.campaign_id,
      rec.lead_id,
      rec.route_plan_id,
      rec.phone,
      rec.transformed_phone,
      rec.cid_used,
      rec.kind ?? 'simulated',
      rec.assigned_user_id ?? null,
      rec.call_uuid ?? null,
      rec.originate_error ?? null,
      rec.correlation_id ?? null,
      rec.recording_path ?? null,
      rec.remote_agent_id ?? null,
      rec.carrier_id ?? null,
    );
  const id = Number(result.lastInsertRowid);
  return db()
    .prepare(`SELECT * FROM dial_intents WHERE id = ?`)
    .get(id) as unknown as DialIntentRecord;
}

/**
 * Iter 58 — live count of in-flight calls bridged to a given remote
 * agent. In-flight = remote_agent_id matches AND hangup_at IS NULL
 * (fs-events populates hangup_at when the call ends). Used by the
 * pacer to skip remote agents that already have `lines` calls live.
 */
/** Iter 84 — throughput + concurrency snapshot for a single
 * campaign, used in the Real-Time panel header. All counts exclude
 * simulated rows (they're DB-only and don't represent real load).
 *   active_now  — real calls currently in flight (hangup_at NULL)
 *   last_1m     — originates in the last 60 seconds
 *   last_10m    — originates in the last 600 seconds
 *   last_60m    — originates in the last 3600 seconds
 *   total       — lifetime cumulative
 * The "originated in window" counts use ts (insert time) so a
 * recently-inserted but still-in-flight row contributes to both
 * `active_now` and the windowed rates. */
export interface CampaignThroughputSnapshot {
  active_now: number;
  last_1m: number;
  last_10m: number;
  last_60m: number;
  total: number;
}

export function campaignThroughput(
  campaignId: string,
): CampaignThroughputSnapshot {
  const row = db()
    .prepare(
      `SELECT
         SUM(CASE WHEN hangup_at IS NULL AND kind != 'simulated' THEN 1 ELSE 0 END) AS active_now,
         SUM(CASE WHEN kind != 'simulated' AND strftime('%s', ts) > strftime('%s','now','-60 seconds') THEN 1 ELSE 0 END) AS last_1m,
         SUM(CASE WHEN kind != 'simulated' AND strftime('%s', ts) > strftime('%s','now','-600 seconds') THEN 1 ELSE 0 END) AS last_10m,
         SUM(CASE WHEN kind != 'simulated' AND strftime('%s', ts) > strftime('%s','now','-3600 seconds') THEN 1 ELSE 0 END) AS last_60m,
         COUNT(*) AS total
       FROM dial_intents
       WHERE campaign_id = ?`,
    )
    .get(campaignId) as {
    active_now: number | null;
    last_1m: number | null;
    last_10m: number | null;
    last_60m: number | null;
    total: number | null;
  };
  return {
    active_now: Number(row.active_now ?? 0),
    last_1m: Number(row.last_1m ?? 0),
    last_10m: Number(row.last_10m ?? 0),
    last_60m: Number(row.last_60m ?? 0),
    total: Number(row.total ?? 0),
  };
}

/** Iter 87 — usage stats for every CID in a group. Joins
 * cid_group_numbers ↔ dial_intents.cid_used and counts each. Last
 * usage timestamp comes from MAX(di.ts). CIDs never used yet
 * appear with count = 0 and last_used = null so the operator sees
 * the full pool, not just the active subset. Excludes simulated
 * rows — those didn't really place a call. */
export interface CidUsageRow {
  number_id: string;
  number: string;
  added_at: string;
  used_count: number;
  last_used_at: string | null;
}

export function cidUsageForGroup(groupId: string): CidUsageRow[] {
  return db()
    .prepare(
      `SELECT
         n.id AS number_id,
         n.number,
         n.created_at AS added_at,
         COALESCE(u.used_count, 0) AS used_count,
         u.last_used_at
       FROM cid_group_numbers n
       LEFT JOIN (
         SELECT cid_used AS num,
                COUNT(*) AS used_count,
                MAX(ts)  AS last_used_at
           FROM dial_intents
          WHERE kind != 'simulated'
            AND cid_used IS NOT NULL
          GROUP BY cid_used
       ) u ON u.num = n.number
       WHERE n.group_id = ?
       ORDER BY used_count DESC, n.created_at ASC, n.number ASC`,
    )
    .all(groupId) as unknown as CidUsageRow[];
}

/** Iter 96 — floor-wide pulse for the / landing dashboard. Single
 * query rolls up real (non-simulated) dial_intent counts across
 * every campaign:
 *   dialing       in flight, not yet answered
 *   connected     answered + still up
 *   last_1m       originates fired in the last 60s
 *   last_10m      last 10 minutes
 *   last_60m      last hour
 *   today         since local-day-midnight, just `>= today-00:00 UTC`
 *                 for now (good-enough until we add a per-tenant
 *                 timezone)
 *   completed_today  NORMAL_CLEARING with answer in the today window
 *                    (talked-to leads)
 *   failed_today     hung up today, NOT answered or not NORMAL_CLEARING
 *                    (busy + no-answer + bad-number + rejected combined)
 */
export interface FloorThroughputSnapshot {
  dialing: number;
  connected: number;
  last_1m: number;
  last_10m: number;
  last_60m: number;
  today: number;
  completed_today: number;
  failed_today: number;
}

export function floorThroughputSnapshot(): FloorThroughputSnapshot {
  const row = db()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE
           WHEN hangup_at IS NULL AND answered_at IS NULL AND kind != 'simulated'
           THEN 1 ELSE 0 END), 0) AS dialing,
         COALESCE(SUM(CASE
           WHEN hangup_at IS NULL AND answered_at IS NOT NULL AND kind != 'simulated'
           THEN 1 ELSE 0 END), 0) AS connected,
         COALESCE(SUM(CASE
           WHEN kind != 'simulated'
            AND strftime('%s', ts) > strftime('%s','now','-60 seconds')
           THEN 1 ELSE 0 END), 0) AS last_1m,
         COALESCE(SUM(CASE
           WHEN kind != 'simulated'
            AND strftime('%s', ts) > strftime('%s','now','-600 seconds')
           THEN 1 ELSE 0 END), 0) AS last_10m,
         COALESCE(SUM(CASE
           WHEN kind != 'simulated'
            AND strftime('%s', ts) > strftime('%s','now','-3600 seconds')
           THEN 1 ELSE 0 END), 0) AS last_60m,
         COALESCE(SUM(CASE
           WHEN kind != 'simulated'
            AND date(ts) = date('now')
           THEN 1 ELSE 0 END), 0) AS today,
         COALESCE(SUM(CASE
           WHEN kind != 'simulated'
            AND date(hangup_at) = date('now')
            AND hangup_cause = 'NORMAL_CLEARING'
            AND answered_at IS NOT NULL
           THEN 1 ELSE 0 END), 0) AS completed_today,
         COALESCE(SUM(CASE
           WHEN kind != 'simulated'
            AND date(hangup_at) = date('now')
            AND (answered_at IS NULL OR hangup_cause != 'NORMAL_CLEARING')
           THEN 1 ELSE 0 END), 0) AS failed_today
       FROM dial_intents`,
    )
    .get() as Record<keyof FloorThroughputSnapshot, number | null>;
  return {
    dialing: Number(row.dialing ?? 0),
    connected: Number(row.connected ?? 0),
    last_1m: Number(row.last_1m ?? 0),
    last_10m: Number(row.last_10m ?? 0),
    last_60m: Number(row.last_60m ?? 0),
    today: Number(row.today ?? 0),
    completed_today: Number(row.completed_today ?? 0),
    failed_today: Number(row.failed_today ?? 0),
  };
}

/** Iter 96 — top active campaigns by today's originate count. For
 * the dashboard's "where the action is" table. Returns name +
 * type + today / last 1m counts, sorted desc. */
export interface CampaignTodayRow {
  id: string;
  name: string;
  type: string;
  status: string;
  today: number;
  last_1m: number;
}

export function topCampaignsToday(
  limit = 5,
): CampaignTodayRow[] {
  return db()
    .prepare(
      `SELECT
         c.id, c.name, c.type, c.status,
         COALESCE(SUM(CASE
           WHEN di.kind != 'simulated' AND date(di.ts) = date('now')
           THEN 1 ELSE 0 END), 0) AS today,
         COALESCE(SUM(CASE
           WHEN di.kind != 'simulated'
            AND strftime('%s', di.ts) > strftime('%s','now','-60 seconds')
           THEN 1 ELSE 0 END), 0) AS last_1m
       FROM campaigns c
       LEFT JOIN dial_intents di ON di.campaign_id = c.id
       GROUP BY c.id, c.name, c.type, c.status
       HAVING today > 0 OR c.status = 'active'
       ORDER BY today DESC, c.status = 'active' DESC, c.name ASC
       LIMIT ?`,
    )
    .all(limit) as unknown as CampaignTodayRow[];
}

/** Iter 85 — per-carrier live snapshot for the /realtime carrier
 * section. For every enabled carrier returns:
 *   dialing      — in flight, no answer yet (answered_at NULL,
 *                  hangup_at NULL)
 *   connected    — answered + still up (answered_at NOT NULL,
 *                  hangup_at NULL)
 *   last_1m      — originates fired in the last 60 seconds
 *   last_10m     — last 10 minutes
 *   last_60m     — last hour
 *   completed_60m — calls that hung up in the last 60m with
 *                   NORMAL_CLEARING + answered_at — i.e. talked-to
 *                   leads in the last hour
 *   failed_60m   — hung up in the last 60m without answer / with
 *                   a non-normal cause — carrier rejections, busy,
 *                   no-answer combined
 * Excludes simulated rows everywhere — they're DB-only and don't
 * reflect carrier load. */
export interface CarrierLiveRow {
  carrier_id: string;
  carrier_name: string;
  enabled: number;
  dialing: number;
  connected: number;
  last_1m: number;
  last_10m: number;
  last_60m: number;
  completed_60m: number;
  failed_60m: number;
}

export function carrierLiveSnapshot(): CarrierLiveRow[] {
  return db()
    .prepare(
      `SELECT
         c.id AS carrier_id,
         c.name AS carrier_name,
         c.enabled,
         COALESCE(SUM(CASE
           WHEN di.hangup_at IS NULL
            AND di.answered_at IS NULL
            AND di.kind != 'simulated'
           THEN 1 ELSE 0 END), 0) AS dialing,
         COALESCE(SUM(CASE
           WHEN di.hangup_at IS NULL
            AND di.answered_at IS NOT NULL
            AND di.kind != 'simulated'
           THEN 1 ELSE 0 END), 0) AS connected,
         COALESCE(SUM(CASE
           WHEN di.kind != 'simulated'
            AND strftime('%s', di.ts) > strftime('%s','now','-60 seconds')
           THEN 1 ELSE 0 END), 0) AS last_1m,
         COALESCE(SUM(CASE
           WHEN di.kind != 'simulated'
            AND strftime('%s', di.ts) > strftime('%s','now','-600 seconds')
           THEN 1 ELSE 0 END), 0) AS last_10m,
         COALESCE(SUM(CASE
           WHEN di.kind != 'simulated'
            AND strftime('%s', di.ts) > strftime('%s','now','-3600 seconds')
           THEN 1 ELSE 0 END), 0) AS last_60m,
         COALESCE(SUM(CASE
           WHEN di.kind != 'simulated'
            AND di.hangup_cause = 'NORMAL_CLEARING'
            AND di.answered_at IS NOT NULL
            AND strftime('%s', di.hangup_at) > strftime('%s','now','-3600 seconds')
           THEN 1 ELSE 0 END), 0) AS completed_60m,
         COALESCE(SUM(CASE
           WHEN di.kind != 'simulated'
            AND di.hangup_at IS NOT NULL
            AND (di.answered_at IS NULL OR di.hangup_cause != 'NORMAL_CLEARING')
            AND strftime('%s', di.hangup_at) > strftime('%s','now','-3600 seconds')
           THEN 1 ELSE 0 END), 0) AS failed_60m
       FROM carriers c
       LEFT JOIN dial_intents di ON di.carrier_id = c.id
       GROUP BY c.id, c.name, c.enabled
       ORDER BY c.name ASC`,
    )
    .all() as unknown as CarrierLiveRow[];
}

/** Iter 108 — per-campaign in-flight count. The pacer's tick uses
 * this to enforce a ceiling on outstanding calls: target this
 * tick = floor(poolSize × dial_level) − inFlightForCampaign. The
 * old math fired poolSize × dial_level *per tick* with no
 * decrement, so with a 3s tick + 30s ringout window a single
 * 5-line dial_level=1 campaign accumulated up to ~50 in-flight
 * calls before reaper / hangups caught up. Same `kind != simulated`
 * + `hangup_at IS NULL` filter the per-agent / per-carrier counters
 * use. */
export function inFlightForCampaign(campaignId: string): number {
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n
         FROM dial_intents
        WHERE campaign_id = ?
          AND hangup_at IS NULL
          AND kind != 'simulated'`,
    )
    .get(campaignId) as { n: number };
  return row.n;
}

export function inFlightForRemoteAgent(remoteAgentId: string): number {
  // Iter 77 — see inFlightForCarrier: only real calls occupy a SIP
  // line on the remote endpoint. Simulated rows would otherwise
  // permanently saturate capacity because there's no FS event flow
  // to ever close them.
  // Iter 81 — fix wrong filter (kind = 'live' never matches the
  // actual pacer kinds: 'originating' / 'originated' /
  // 'originate_failed'). With the bug, in-flight was always 0 so
  // a remote with lines=1 still got dialed every 3-second tick;
  // calls piled up well past the configured line count. Use
  // `!= 'simulated'` so the cap actually caps.
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n
         FROM dial_intents
        WHERE remote_agent_id = ?
          AND hangup_at IS NULL
          AND kind != 'simulated'`,
    )
    .get(remoteAgentId) as { n: number };
  return row.n;
}

/** Iter 79 — update a dial_intent row with the result of its bgapi
 * originate. Called by the pacer after the originate returns so we
 * don't have to re-run insert with extra columns. The row was
 * pre-inserted with correlation_id so the FS event listener could
 * already match it; this stamps call_uuid / originate_error / kind
 * after the fact. */
export function applyDialIntentOriginate(args: {
  id: number;
  call_uuid: string | null;
  originate_error: string | null;
  kind: string;
}): void {
  db()
    .prepare(
      `UPDATE dial_intents
          SET call_uuid = ?,
              originate_error = ?,
              kind = ?
        WHERE id = ?`,
    )
    .run(args.call_uuid, args.originate_error, args.kind, args.id);
}

/** Iter 77 — close a dial_intent by id, stamping hangup_at = ts so
 * the row doesn't sit "in-flight" forever. Used for simulated rows
 * which have no FS event flow to update them naturally. */
export function closeSimulatedDialIntent(intentId: number): void {
  db()
    .prepare(
      `UPDATE dial_intents
          SET hangup_at = ts
        WHERE id = ? AND hangup_at IS NULL AND kind = 'simulated'`,
    )
    .run(intentId);
}

/** Iter 77 — mark live dial_intents that never received a hangup
 * event as hung. The FS event listener normally updates hangup_at
 * when CHANNEL_DESTROY arrives, but if the listener is restarted
 * mid-call, the carrier never delivers BYE, or the call_uuid never
 * came back — those rows can sit "in-flight" forever and pin port
 * caps / remote-agent line capacity. Returns the count of rows
 * reaped.
 *
 * Threshold defaults to 300s (5 min) which covers normal call
 * length with a generous safety margin. The annotation lands in
 * originate_error so an admin can grep audit / dial_intents to see
 * what was reaped. */
export function reapStaleDialIntents(maxAgeSeconds = 120): number {
  // Iter 83 — same bug as inFlightForCarrier / inFlightForRemoteAgent
  // (fixed in iter 81): the filter was `kind = 'live'`, but the pacer
  // never writes that value (it writes 'originating' / 'originated' /
  // 'originate_failed'). With the wrong filter the reaper matched
  // nothing — every dropped hangup event left a permanent zombie.
  // Use `!= 'simulated'` so every real kind is reapable.
  // Threshold also dropped from 300s to 120s — typical answered calls
  // are < 60s and unanswered SIP transactions terminate in < 32s, so
  // 120s is a generous floor for "this row's hangup event never
  // arrived". Reaper runs every 60s; worst-case dwell as a zombie is
  // now 180s instead of 360s.
  const result = db()
    .prepare(
      `UPDATE dial_intents
          SET hangup_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
              originate_error = COALESCE(
                originate_error,
                ?
              )
        WHERE hangup_at IS NULL
          AND kind != 'simulated'
          AND strftime('%s', 'now') - strftime('%s', ts) > ?`,
    )
    .run(
      `reaped: no hangup event within ${maxAgeSeconds}s`,
      maxAgeSeconds,
    );
  return Number(result.changes);
}

/**
 * Iter 33 — write FS event outcomes back onto a dial_intent row,
 * matched by correlation_id. Returns the updated row, or undefined if
 * no row matched (e.g. event for a call we didn't originate, like the
 * sample default gateway calls).
 */
export function applyDialIntentHangup(args: {
  correlation_id: string;
  hangup_cause: string;
  hangup_at: string;
  duration_ms: number;
  answered_at?: string | null;
  // Iter 122 — captured from variable_dialeros_amd_result on
  // CHANNEL_HANGUP_COMPLETE for campaigns with amd_action=detect.
  // Undefined when no AMD ran (skip the column update); null is
  // a deliberate "ran but couldn't classify" override.
  amd_result?: string | null;
}): DialIntentRecord | undefined {
  const sets: string[] = [
    'hangup_cause = ?',
    'hangup_at = ?',
    'duration_ms = ?',
  ];
  const vals: unknown[] = [
    args.hangup_cause,
    args.hangup_at,
    args.duration_ms,
  ];
  if (args.answered_at !== undefined) {
    sets.push('answered_at = ?');
    vals.push(args.answered_at);
  }
  if (args.amd_result !== undefined) {
    sets.push('amd_result = ?');
    vals.push(args.amd_result);
  }
  vals.push(args.correlation_id);
  const result = db()
    .prepare(
      `UPDATE dial_intents SET ${sets.join(', ')}
       WHERE correlation_id = ?`,
    )
    .run(...(vals as never[]));
  if (Number(result.changes) === 0) return undefined;
  return db()
    .prepare(`SELECT * FROM dial_intents WHERE correlation_id = ?`)
    .get(args.correlation_id) as unknown as DialIntentRecord;
}

export function applyDialIntentAnswered(args: {
  correlation_id: string;
  answered_at: string;
}): DialIntentRecord | undefined {
  const result = db()
    .prepare(
      `UPDATE dial_intents SET answered_at = ? WHERE correlation_id = ?`,
    )
    .run(args.answered_at, args.correlation_id);
  if (Number(result.changes) === 0) return undefined;
  return db()
    .prepare(`SELECT * FROM dial_intents WHERE correlation_id = ?`)
    .get(args.correlation_id) as unknown as DialIntentRecord;
}

/**
 * Returns active agents attached to the campaign — the pool the pacing
 * engine round-robins over. Filters: is_active = 1 AND role = 'agent'.
 * Admins/supervisors aren't in this pool — they don't take calls; they
 * have full read access by role for everything else.
 */
export function getActiveAgentsForCampaign(
  campaignId: string,
): Array<{ id: string; username: string; display_name: string | null; skill_tier: string }> {
  return db()
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.skill_tier
       FROM users u
       JOIN user_campaigns uc ON uc.user_id = u.id
       WHERE uc.campaign_id = ?
         AND u.is_active = 1
         AND u.role = 'agent'
       ORDER BY u.username ASC`,
    )
    .all(campaignId) as unknown as Array<{
    id: string;
    username: string;
    display_name: string | null;
    skill_tier: string;
  }>;
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

/** Iter 126 — campaign-scoped call history for CSV export. Joins
 * dial_intents × leads × carriers so the CSV is self-contained
 * (lead phone/name + carrier name, not just FKs). Excludes
 * simulated rows since exports almost always go to billing /
 * compliance / CRM where simulated calls are noise. Optional
 * sinceIso clamps to a date range — supports "calls in May" or
 * "last 24h" exports without sucking the whole campaign down. */
export interface CampaignCallHistoryRow {
  id: number;
  ts: string;
  campaign_id: string;
  lead_id: string;
  lead_phone: string;
  lead_name: string | null;
  transformed_phone: string;
  cid_used: string | null;
  kind: string;
  assigned_user_id: string | null;
  carrier_id: string | null;
  carrier_name: string | null;
  answered_at: string | null;
  hangup_at: string | null;
  hangup_cause: string | null;
  duration_ms: number | null;
  disposition: string | null;
  dispositioned_at: string | null;
  amd_result: string | null;
  recording_path: string | null;
  originate_error: string | null;
}
export function listCampaignCallHistoryForExport(
  campaignId: string,
  sinceIso: string | null,
): CampaignCallHistoryRow[] {
  const where: string[] = [
    'di.campaign_id = ?',
    "di.kind != 'simulated'",
  ];
  const values: unknown[] = [campaignId];
  if (sinceIso) {
    where.push('di.ts >= ?');
    values.push(sinceIso);
  }
  return db()
    .prepare(
      `SELECT di.id, di.ts,
              di.campaign_id, di.lead_id,
              l.phone AS lead_phone, l.name AS lead_name,
              di.transformed_phone, di.cid_used, di.kind,
              di.assigned_user_id,
              di.carrier_id, c.name AS carrier_name,
              di.answered_at, di.hangup_at, di.hangup_cause,
              di.duration_ms,
              di.disposition, di.dispositioned_at,
              di.amd_result,
              di.recording_path, di.originate_error
         FROM dial_intents di
         JOIN leads l ON l.id = di.lead_id
         LEFT JOIN carriers c ON c.id = di.carrier_id
        WHERE ${where.join(' AND ')}
        ORDER BY di.id ASC`,
    )
    .all(...(values as never[])) as unknown as CampaignCallHistoryRow[];
}

/* Iter 142 — Floor-wide call history with filters. Powers the
 * /supervisor/calls page: filter by campaign, agent, disposition,
 * AMD result, and recording-presence; returns rows newest-first with
 * a hard cap. JOINs in campaign + agent + carrier names so the
 * client doesn't need a second round trip to render labels.
 *
 * Excludes simulated rows for the same reason
 * listCampaignCallHistoryForExport does — they're noise in any
 * QA/compliance context. */
export interface FloorCallHistoryRow {
  id: number;
  ts: string;
  campaign_id: string;
  campaign_name: string | null;
  lead_id: string;
  lead_phone: string;
  lead_name: string | null;
  transformed_phone: string;
  cid_used: string | null;
  kind: string;
  assigned_user_id: string | null;
  assigned_username: string | null;
  carrier_id: string | null;
  carrier_name: string | null;
  answered_at: string | null;
  hangup_at: string | null;
  hangup_cause: string | null;
  duration_ms: number | null;
  disposition: string | null;
  dispositioned_at: string | null;
  disposition_origin: string | null;
  amd_result: string | null;
  recording_path: string | null;
  originate_error: string | null;
}

export interface FloorCallHistoryFilters {
  sinceIso?: string | null;
  untilIso?: string | null;
  campaignId?: string | null;
  agentUserId?: string | null;
  disposition?: string | null;
  amdResult?: string | null;
  onlyWithRecording?: boolean;
  /** Hard-capped at 500 server-side regardless of caller input. */
  limit?: number;
}

export function listFloorCallHistory(
  f: FloorCallHistoryFilters,
): FloorCallHistoryRow[] {
  const where: string[] = ["di.kind != 'simulated'"];
  const values: unknown[] = [];
  if (f.sinceIso) {
    where.push('di.ts >= ?');
    values.push(f.sinceIso);
  }
  if (f.untilIso) {
    where.push('di.ts < ?');
    values.push(f.untilIso);
  }
  if (f.campaignId) {
    where.push('di.campaign_id = ?');
    values.push(f.campaignId);
  }
  if (f.agentUserId) {
    where.push('di.assigned_user_id = ?');
    values.push(f.agentUserId);
  }
  if (f.disposition) {
    where.push('di.disposition = ?');
    values.push(f.disposition);
  }
  if (f.amdResult) {
    where.push('di.amd_result = ?');
    values.push(f.amdResult);
  }
  if (f.onlyWithRecording) {
    where.push('di.recording_path IS NOT NULL');
  }
  const limit = Math.max(1, Math.min(500, f.limit ?? 200));
  return db()
    .prepare(
      `SELECT di.id, di.ts,
              di.campaign_id, cm.name AS campaign_name,
              di.lead_id, l.phone AS lead_phone, l.name AS lead_name,
              di.transformed_phone, di.cid_used, di.kind,
              di.assigned_user_id, u.username AS assigned_username,
              di.carrier_id, c.name AS carrier_name,
              di.answered_at, di.hangup_at, di.hangup_cause,
              di.duration_ms,
              di.disposition, di.dispositioned_at, di.disposition_origin,
              di.amd_result,
              di.recording_path, di.originate_error
         FROM dial_intents di
         JOIN leads l ON l.id = di.lead_id
         LEFT JOIN campaigns cm ON cm.id = di.campaign_id
         LEFT JOIN users u ON u.id = di.assigned_user_id
         LEFT JOIN carriers c ON c.id = di.carrier_id
        WHERE ${where.join(' AND ')}
        ORDER BY di.id DESC
        LIMIT ?`,
    )
    .all(...(values as never[]), limit) as unknown as FloorCallHistoryRow[];
}

/* Iter 143 — Single-row fetch for the /calls/[id] detail page.
 * Same joins as listFloorCallHistory plus route_plan_name (the
 * detail view shows which plan picked the carrier + CID) and the
 * AI columns (transcript_text, ai_summary, ai_sentiment, ai_flags,
 * ai_processed_at). Returns undefined for unknown ids so the page
 * can render a 404.
 *
 * Authorization is the caller's responsibility — the detail page
 * does an admin/supervisor-OR-assignee check before invoking. */
export interface CallDetailRow {
  id: number;
  ts: string;
  correlation_id: string | null;
  call_uuid: string | null;
  campaign_id: string;
  campaign_name: string | null;
  lead_id: string;
  lead_phone: string;
  lead_name: string | null;
  transformed_phone: string;
  cid_used: string | null;
  kind: string;
  assigned_user_id: string | null;
  assigned_username: string | null;
  assigned_display_name: string | null;
  route_plan_id: string | null;
  route_plan_name: string | null;
  carrier_id: string | null;
  carrier_name: string | null;
  answered_at: string | null;
  hangup_at: string | null;
  hangup_cause: string | null;
  duration_ms: number | null;
  disposition: string | null;
  dispositioned_at: string | null;
  disposition_origin: string | null;
  amd_result: string | null;
  recording_path: string | null;
  originate_error: string | null;
  transcript_text: string | null;
  ai_summary: string | null;
  ai_sentiment: string | null;
  ai_flags: string | null;
  ai_processed_at: string | null;
}

/* Iter 146 — apply a system-inferred disposition. Idempotent:
 * a row that already has a disposition (set by an agent or by a
 * prior auto-tag run) is left alone. The WHERE clause enforces
 * that at SQL level so concurrent fs-events + backfill calls
 * can't race into a double-write.
 *
 * Returns the updated row, or undefined when no row matched
 * (already dispositioned, or correlation_id unknown). */
export function applyAutoDisposition(
  correlationId: string,
  disposition: string,
): DialIntentRecord | undefined {
  const result = db()
    .prepare(
      `UPDATE dial_intents
          SET disposition = ?,
              dispositioned_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              disposition_origin = 'auto'
        WHERE correlation_id = ?
          AND disposition IS NULL`,
    )
    .run(disposition, correlationId);
  if (Number(result.changes) === 0) return undefined;
  return db()
    .prepare(`SELECT * FROM dial_intents WHERE correlation_id = ?`)
    .get(correlationId) as unknown as DialIntentRecord;
}

/* Iter 146 — list rows that are candidates for the auto-dispose
 * backfill: hangup is final, no disposition yet, not simulated.
 * Oldest-first so chunked re-runs naturally advance. Pulls only
 * the fields inferAutoDisposition + the route handler need. */
export interface AutoDispositionCandidate {
  id: number;
  campaign_id: string;
  correlation_id: string | null;
  disposition: string | null;
  originate_error: string | null;
  answered_at: string | null;
  assigned_user_id: string | null;
  hangup_cause: string | null;
  amd_result: string | null;
}
export function listAutoDispositionCandidates(
  limit: number,
): AutoDispositionCandidate[] {
  return db()
    .prepare(
      `SELECT id, campaign_id, correlation_id, disposition,
              originate_error, answered_at, assigned_user_id,
              hangup_cause, amd_result
         FROM dial_intents
        WHERE disposition IS NULL
          AND hangup_at IS NOT NULL
          AND kind != 'simulated'
        ORDER BY id ASC
        LIMIT ?`,
    )
    .all(limit) as unknown as AutoDispositionCandidate[];
}

/* Iter 144 — bulk-NULL recording_path on rows whose .wav file
 * the prune job is about to delete. Chunked at 500 placeholders
 * per UPDATE so a single tick that deletes thousands of old
 * recordings doesn't bump sqlite's 999-param ceiling. Returns
 * the total number of rows whose recording_path column was
 * cleared (NOT the number of file paths processed — some paths
 * may not have a matching dial_intent if rows were already
 * pruned). */
export function clearRecordingPathsForFiles(paths: string[]): number {
  if (paths.length === 0) return 0;
  const CHUNK = 500;
  let total = 0;
  const conn = db();
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const result = conn
      .prepare(
        `UPDATE dial_intents
            SET recording_path = NULL
          WHERE recording_path IN (${placeholders})`,
      )
      .run(...chunk);
    total += Number(result.changes ?? 0);
  }
  return total;
}

/* Iter 147 — rolling abandon-rate for a campaign. Used by the
 * pacer to self-throttle when the FCC 3% cap (or whichever
 * campaign-configured max_abandon_pct) would be breached, and
 * by the UI card on the campaign detail page.
 *
 * Sample is the last N dispositioned non-simulated calls. We
 * count rows with disposition='A' (the iter-146 auto-disposition
 * code for "answered but no agent on bridge"). Manual agent
 * dispositions aren't 'A' so they're naturally excluded.
 *
 * Returning rate_pct as a percentage (0..100) matches the
 * campaign.max_abandon_pct column which is stored the same way.
 */
export interface CampaignAbandonRate {
  abandoned: number;
  total: number;
  rate_pct: number;
  sample_size: number;
}
export function getCampaignAbandonRate(
  campaignId: string,
  sampleSize = 100,
): CampaignAbandonRate {
  const rows = db()
    .prepare(
      `SELECT disposition
         FROM dial_intents
        WHERE campaign_id = ?
          AND disposition IS NOT NULL
          AND dispositioned_at IS NOT NULL
          AND kind != 'simulated'
        ORDER BY id DESC
        LIMIT ?`,
    )
    .all(campaignId, sampleSize) as Array<{ disposition: string }>;
  const total = rows.length;
  const abandoned = rows.reduce(
    (n, r) => n + (r.disposition === 'A' ? 1 : 0),
    0,
  );
  const rate_pct = total > 0 ? (abandoned / total) * 100 : 0;
  return { abandoned, total, rate_pct, sample_size: sampleSize };
}

export function getCallDetail(id: number): CallDetailRow | undefined {
  return db()
    .prepare(
      `SELECT di.id, di.ts, di.correlation_id, di.call_uuid,
              di.campaign_id, cm.name AS campaign_name,
              di.lead_id, l.phone AS lead_phone, l.name AS lead_name,
              di.transformed_phone, di.cid_used, di.kind,
              di.assigned_user_id,
              u.username AS assigned_username,
              u.display_name AS assigned_display_name,
              di.route_plan_id, rp.name AS route_plan_name,
              di.carrier_id, c.name AS carrier_name,
              di.answered_at, di.hangup_at, di.hangup_cause,
              di.duration_ms,
              di.disposition, di.dispositioned_at, di.disposition_origin,
              di.amd_result,
              di.recording_path, di.originate_error,
              di.transcript_text, di.ai_summary,
              di.ai_sentiment, di.ai_flags, di.ai_processed_at
         FROM dial_intents di
         JOIN leads l ON l.id = di.lead_id
         LEFT JOIN campaigns cm ON cm.id = di.campaign_id
         LEFT JOIN users u ON u.id = di.assigned_user_id
         LEFT JOIN route_plans rp ON rp.id = di.route_plan_id
         LEFT JOIN carriers c ON c.id = di.carrier_id
        WHERE di.id = ?`,
    )
    .get(id) as unknown as CallDetailRow | undefined;
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
 * Iter 17 — agent console. Returns recent dial intents assigned to a
 * specific user, joined with campaign + lead context so the agent UI can
 * render a readable feed without N+1 lookups.
 */
export interface AgentIntentRecord extends DialIntentRecord {
  campaign_name: string;
  lead_name: string | null;
}

export function listDialIntentsForUser(
  userId: string,
  limit = 100,
  sinceId = 0,
): AgentIntentRecord[] {
  return db()
    .prepare(
      `SELECT i.*, c.name AS campaign_name, l.name AS lead_name
         FROM dial_intents i
         JOIN campaigns c ON c.id = i.campaign_id
         LEFT JOIN leads l ON l.id = i.lead_id
        WHERE i.assigned_user_id = ? AND i.id > ?
        ORDER BY i.id DESC
        LIMIT ?`,
    )
    .all(userId, sinceId, limit) as unknown as AgentIntentRecord[];
}

/**
 * Iter 67 — per-campaign live snapshot. One row per non-archived
 * campaign joined with the route plan's primary carrier and rolled
 * up hopper / in-flight counts. The realtime view polls this.
 */
export interface CampaignLiveRow {
  id: string;
  name: string;
  status: string;
  dial_mode: string;
  type: string;
  dial_level: number;
  hopper_level: number;
  hopper_depth: number;
  in_flight: number;
  carrier_id: string | null;
  carrier_name: string | null;
  carrier_enabled: number | null;
  amd_action: string;
}
export function liveCampaignSnapshot(): CampaignLiveRow[] {
  return db()
    .prepare(
      `SELECT c.id, c.name, c.status, c.dial_mode, c.type,
              c.dial_level, c.hopper_level, c.amd_action,
              cr.id   AS carrier_id,
              cr.name AS carrier_name,
              cr.enabled AS carrier_enabled,
              (SELECT COUNT(*) FROM lead_hopper h WHERE h.campaign_id = c.id)
                AS hopper_depth,
              (SELECT COUNT(*) FROM dial_intents i
                 WHERE i.campaign_id = c.id
                   AND i.answered_at IS NOT NULL
                   AND i.hangup_at IS NULL
                   AND i.call_uuid IS NOT NULL)
                AS in_flight
         FROM campaigns c
         LEFT JOIN route_plans rp ON rp.id = c.route_plan_id
         LEFT JOIN carriers cr ON cr.id = rp.primary_carrier_id
        WHERE c.status != 'archived'
        ORDER BY c.status DESC, c.name ASC`,
    )
    .all() as unknown as CampaignLiveRow[];
}

/**
 * Iter 67 — agent live status. AVAILABLE / PAUSED is the agent_status
 * value; IN_CALL is inferred from an undisposed dial_intent that's
 * still mid-call (answered_at set, hangup_at NULL). Joins the latest
 * such intent for caller-id + duration so the realtime view doesn't
 * need an N+1 lookup.
 */
export interface AgentLiveRow {
  user_id: string;
  username: string;
  display_name: string | null;
  role: string;
  is_active: number;
  manual_dial: number;
  status: string;
  pause_reason: string | null;
  call_intent_id: number | null;
  call_phone: string | null;
  call_answered_at: string | null;
  dispositions_today: number;
}
export function liveAgentSnapshot(): AgentLiveRow[] {
  // Pull users + their agent_status, plus the most recent live intent
  // (answered, not hung up) assigned to them. dispositions_today via
  // the same per-day pattern as countDispositionsTodayForUser.
  return db()
    .prepare(
      `SELECT u.id  AS user_id,
              u.username,
              u.display_name,
              u.role,
              u.is_active,
              u.manual_dial,
              COALESCE(s.status, 'AVAILABLE') AS status,
              s.reason AS pause_reason,
              i.id     AS call_intent_id,
              i.transformed_phone AS call_phone,
              i.answered_at AS call_answered_at,
              (
                SELECT COUNT(*) FROM dial_intents d
                 WHERE d.assigned_user_id = u.id
                   AND d.dispositioned_at IS NOT NULL
                   AND date(d.dispositioned_at) = date('now')
              ) AS dispositions_today
         FROM users u
         LEFT JOIN agent_status s ON s.user_id = u.id
         LEFT JOIN dial_intents i
                ON i.id = (
                  SELECT MAX(id) FROM dial_intents
                   WHERE assigned_user_id = u.id
                     AND answered_at IS NOT NULL
                     AND hangup_at IS NULL
                     AND call_uuid IS NOT NULL
                )
        WHERE u.is_active = 1
          AND u.role IN ('agent', 'supervisor', 'admin')
        ORDER BY
          CASE COALESCE(s.status, 'AVAILABLE')
            WHEN 'AVAILABLE' THEN 0
            WHEN 'PAUSED'    THEN 1
            ELSE 2
          END,
          u.username ASC`,
    )
    .all() as unknown as AgentLiveRow[];
}

/**
 * Iter 65 — supervisor floor view. Returns every dial_intent that
 * is currently mid-call: answered_at set + hangup_at NULL. Joined
 * with campaign + user names so the supervisor table doesn't need
 * an N+1 lookup. Sorted by call duration descending so the longest
 * call surfaces first (typical "what's that long call about?"
 * triage).
 */
export interface ActiveCallRecord extends DialIntentRecord {
  campaign_name: string;
  /** Iter 93 — campaign type (outbound_predictive / inbound_queue
   * / blended / manual_only) so the UI can render a Direction
   * column ("OUT" / "IN" / "BLD") without a second query. */
  campaign_type: string;
  user_username: string | null;
}
export function listActiveCalls(): ActiveCallRecord[] {
  return db()
    .prepare(
      `SELECT i.*, c.name AS campaign_name, c.type AS campaign_type,
              u.username AS user_username
         FROM dial_intents i
         JOIN campaigns c ON c.id = i.campaign_id
         LEFT JOIN users u ON u.id = i.assigned_user_id
        WHERE i.answered_at IS NOT NULL
          AND i.hangup_at IS NULL
          AND i.call_uuid IS NOT NULL
        ORDER BY i.answered_at ASC`,
    )
    .all() as unknown as ActiveCallRecord[];
}

/**
 * Iter 55 — single row by id. Used by the recording stream endpoint
 * to verify ownership / existence before piping the .wav out.
 */
export function getDialIntentById(id: number): DialIntentRecord | undefined {
  return db()
    .prepare(`SELECT * FROM dial_intents WHERE id = ?`)
    .get(id) as unknown as DialIntentRecord | undefined;
}

/** Iter 95 — lookup by correlation_id for the agent softphone's
 * polling fallback. When sip.js misses a BYE (transient WS drop,
 * proxy hiccup), the client polls this endpoint with its dial's
 * correlation_id; if hangup_at is set the client force-clears its
 * stuck "Connected" UI. */
export function getDialIntentByCorrelationId(
  correlationId: string,
): DialIntentRecord | undefined {
  return db()
    .prepare(`SELECT * FROM dial_intents WHERE correlation_id = ?`)
    .get(correlationId) as unknown as DialIntentRecord | undefined;
}

/**
 * Iter 46 — most recent intent assigned to this user that has no
 * disposition yet. Drives the wrap-up modal: when an agent's call
 * ends we look this up and pin them to dispositioning it.
 */
export function latestUndisposedIntentForUser(
  userId: string,
): AgentIntentRecord | undefined {
  return db()
    .prepare(
      `SELECT i.*, c.name AS campaign_name, l.name AS lead_name
         FROM dial_intents i
         JOIN campaigns c ON c.id = i.campaign_id
         LEFT JOIN leads l ON l.id = i.lead_id
        WHERE i.assigned_user_id = ? AND i.disposition IS NULL
        ORDER BY i.id DESC
        LIMIT 1`,
    )
    .get(userId) as unknown as AgentIntentRecord | undefined;
}

export function countDialIntentsForUser(userId: string): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM dial_intents WHERE assigned_user_id = ?`)
    .get(userId) as { n: number };
  return row.n;
}

/**
 * Iter 18 — apply an agent disposition to a single dial intent and the
 * underlying lead in one transaction. Returns the freshly-updated
 * intent, or undefined if the intent does not exist or does not belong
 * to userId (so HTTP layer can 404 vs 200 cleanly).
 *
 * Lead status is the source of truth that the pacer's pickNextDialableLead
 * filters on. Outcome → lead status mapping:
 *   SALE                → CONVERTED
 *   DNC                 → DNC
 *   NO_INTEREST         → DEAD
 *   WRONG_NUMBER        → BAD_NUMBER
 *   BAD_NUMBER          → BAD_NUMBER
 *   ANSWERING_MACHINE   → CALLED_NO_ANSWER (re-dialable)
 *   CALLBACK            → CALLBACK_SCHEDULED (re-dialable after callback_at)
 */
export function disposeIntent(args: {
  intentId: number;
  userId: string;
  disposition: string;
  newLeadStatus: string;
  callbackAt: string | null;
}): DialIntentRecord | undefined {
  const d = db();
  const tx = d.exec.bind(d);

  // Verify intent exists + belongs to user + is not already dispositioned
  const intent = d
    .prepare(`SELECT * FROM dial_intents WHERE id = ?`)
    .get(args.intentId) as unknown as DialIntentRecord | undefined;
  if (!intent) return undefined;
  if (intent.assigned_user_id !== args.userId) return undefined;
  if (intent.disposition) return intent; // idempotent — second click is a no-op

  tx('BEGIN');
  try {
    d.prepare(
      `UPDATE dial_intents
         SET disposition = ?,
             dispositioned_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             disposition_origin = 'agent',
             callback_at = ?
       WHERE id = ?`,
    ).run(args.disposition, args.callbackAt, args.intentId);

    // Mirror callback_at onto the lead so the schedule-aware picker can
    // compare without joining back to dial_intents. Cleared on every
    // disposition (other outcomes nuke any stale callback time).
    d.prepare(
      `UPDATE leads
         SET status = ?, callback_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(args.newLeadStatus, args.callbackAt, intent.lead_id);

    tx('COMMIT');
  } catch (e) {
    tx('ROLLBACK');
    throw e;
  }

  return d
    .prepare(`SELECT * FROM dial_intents WHERE id = ?`)
    .get(args.intentId) as unknown as DialIntentRecord;
}

/** Number of intents the user dispositioned since UTC midnight of `now`. */
export function countDispositionsTodayForUser(userId: string): number {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.toISOString();
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n
         FROM dial_intents
        WHERE assigned_user_id = ?
          AND disposition IS NOT NULL
          AND dispositioned_at >= ?`,
    )
    .get(userId, since) as { n: number };
  return row.n;
}

/** Iter 100 — per-agent leaderboard for today. One JOIN aggregate
 * across users × today's dial_intents. Excludes simulated rows.
 * Includes every active user with role agent/supervisor (admin
 * too — admins QA the floor and their stats are legitimate) so
 * agents who haven't logged a call yet still appear with zeroes
 * — supervisors can spot "signed in but idle". Sorted by talk
 * time desc (the closest proxy for productive shift time) with a
 * call-count tiebreak. */
export interface AgentLeaderboardRow {
  user_id: string;
  username: string;
  display_name: string | null;
  role: string;
  calls_today: number;
  talked_today: number;
  talk_time_ms_today: number;
  dispositions_today: number;
}
export function agentLeaderboardToday(): AgentLeaderboardRow[] {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.toISOString();
  return db()
    .prepare(
      `SELECT u.id   AS user_id,
              u.username,
              u.display_name,
              u.role,
              COALESCE(SUM(CASE
                WHEN di.assigned_user_id = u.id
                 AND di.kind != 'simulated'
                 AND di.ts >= ?
                THEN 1 ELSE 0 END), 0) AS calls_today,
              COALESCE(SUM(CASE
                WHEN di.assigned_user_id = u.id
                 AND di.kind != 'simulated'
                 AND di.ts >= ?
                 AND di.answered_at IS NOT NULL
                THEN 1 ELSE 0 END), 0) AS talked_today,
              COALESCE(SUM(CASE
                WHEN di.assigned_user_id = u.id
                 AND di.kind != 'simulated'
                 AND di.ts >= ?
                 AND di.answered_at IS NOT NULL
                THEN di.duration_ms ELSE 0 END), 0) AS talk_time_ms_today,
              COALESCE(SUM(CASE
                WHEN di.assigned_user_id = u.id
                 AND di.kind != 'simulated'
                 AND di.dispositioned_at IS NOT NULL
                 AND di.dispositioned_at >= ?
                THEN 1 ELSE 0 END), 0) AS dispositions_today
         FROM users u
         LEFT JOIN dial_intents di ON di.assigned_user_id = u.id
        WHERE u.is_active = 1
          AND u.role IN ('agent', 'supervisor', 'admin')
        GROUP BY u.id, u.username, u.display_name, u.role
        ORDER BY talk_time_ms_today DESC,
                 calls_today DESC,
                 u.username ASC`,
    )
    .all(since, since, since, since) as unknown as AgentLeaderboardRow[];
}


/** Iter 135 — list dial_intents waiting for AI processing.
 * Filters: not simulated, actually answered (transcribing a
 * busy/no-answer recording is wasted spend), has a recording_path
 * (FS wrote a wav), and hangup_at IS NOT NULL (call is over so
 * the wav is fully flushed to disk). ai_processed_at IS NULL is
 * the dedupe — once the worker POSTs back we stamp this and the
 * row drops off the pending list.
 *
 * Limit defaults to 10 so an operator running a serial worker
 * doesn't grab the entire backlog in one tick. Worker can pass
 * a higher limit when running parallel.
 */
export interface AiPendingIntent {
  id: number;
  ts: string;
  campaign_id: string;
  campaign_name: string | null;
  lead_id: string;
  lead_phone: string;
  recording_path: string;
  duration_ms: number | null;
  answered_at: string;
  hangup_at: string;
}
export function listAiPendingIntents(limit = 10): AiPendingIntent[] {
  return db()
    .prepare(
      `SELECT di.id, di.ts,
              di.campaign_id, c.name AS campaign_name,
              di.lead_id, l.phone AS lead_phone,
              di.recording_path,
              di.duration_ms, di.answered_at, di.hangup_at
         FROM dial_intents di
         JOIN leads l ON l.id = di.lead_id
         LEFT JOIN campaigns c ON c.id = di.campaign_id
        WHERE di.kind != 'simulated'
          AND di.recording_path IS NOT NULL
          AND di.answered_at IS NOT NULL
          AND di.hangup_at IS NOT NULL
          AND di.ai_processed_at IS NULL
        ORDER BY di.id ASC
        LIMIT ?`,
    )
    .all(limit) as unknown as AiPendingIntent[];
}

/** Iter 135 — store transcript + summary back on a dial_intent.
 * Either transcript or summary may be NULL (e.g. summary
 * pipeline failed but transcript landed). ai_processed_at is
 * always stamped so the row falls off the pending list, even
 * when both columns are NULL — the operator's worker would
 * otherwise loop forever on a row that crashes the LLM. */
export function applyAiResult(args: {
  id: number;
  transcript_text: string | null;
  ai_summary: string | null;
  ai_sentiment?: string | null;
  ai_flags?: string[] | null;
}): boolean {
  // Iter 138 — sentiment + flags are optional and only landed when
  // the worker actually classified them. We always stamp
  // ai_processed_at so the row falls off the pending list even
  // when only transcript/summary land.
  const flagsJson =
    args.ai_flags === null || args.ai_flags === undefined
      ? null
      : JSON.stringify(args.ai_flags);
  const result = db()
    .prepare(
      `UPDATE dial_intents
          SET transcript_text = ?,
              ai_summary = ?,
              ai_sentiment = ?,
              ai_flags = ?,
              ai_processed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?`,
    )
    .run(
      args.transcript_text,
      args.ai_summary,
      args.ai_sentiment ?? null,
      flagsJson,
      args.id,
    );
  return Number(result.changes) > 0;
}

/** Iter 138 — FTS5-backed full-text search over transcripts +
 * AI summaries. Returns the dial_intent row plus a snippet
 * containing the match (sqlite's snippet() with 5-token
 * windows). Results are ranked by BM25; the LIMIT keeps
 * cross-call grep-style queries fast even on million-row
 * tables. */
export interface TranscriptHit {
  id: number;
  ts: string;
  campaign_id: string;
  campaign_name: string | null;
  lead_id: string;
  lead_phone: string;
  snippet: string;
  ai_summary: string | null;
  ai_sentiment: string | null;
  ai_flags: string | null;
  duration_ms: number | null;
}
export function searchTranscripts(
  query: string,
  limit = 50,
): TranscriptHit[] {
  // FTS5's MATCH syntax requires the query column or the whole
  // table — we let the user query both fields by default. We
  // sanitise the input by escaping double quotes and wrapping
  // each whitespace-separated token in quotes so phrase
  // searches work without an operator footgun ("Bob's
  // mortgage" doesn't trip the FTS5 grammar).
  const clean = query
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 10) // cap to 10 tokens; longer queries get truncated rather than failing
    .map((t) => '"' + t.replace(/"/g, '""') + '"')
    .join(' ');
  if (!clean) return [];
  return db()
    .prepare(
      `SELECT di.id, di.ts, di.campaign_id, c.name AS campaign_name,
              di.lead_id, l.phone AS lead_phone,
              snippet(dial_intents_fts, 0, '<mark>', '</mark>', '…', 12) AS snippet,
              di.ai_summary, di.ai_sentiment, di.ai_flags, di.duration_ms
         FROM dial_intents_fts
         JOIN dial_intents di ON di.id = dial_intents_fts.rowid
         JOIN leads l ON l.id = di.lead_id
         LEFT JOIN campaigns c ON c.id = di.campaign_id
        WHERE dial_intents_fts MATCH ?
        ORDER BY bm25(dial_intents_fts)
        LIMIT ?`,
    )
    .all(clean, limit) as unknown as TranscriptHit[];
}



/** Iter 132 — predictive pacing data layer: answer-rate buckets
 * by (hour, weekday). Pure SQL aggregate over the last N days
 * of non-simulated, non-originate-failed dial intents. The
 * `kind != 'originate_failed'` filter matters because failed
 * originates never had a chance to be answered and would skew
 * the denominator downward, making it look like the destination
 * pool is dialing dead. */
export interface AnswerRateBucket {
  hour: number;
  weekday: number;
  total: number;
  answered: number;
  /** Fraction 0..1. -1 sentinel when total = 0. */
  answer_rate: number;
}
export interface AnswerRateSummary {
  since_iso: string;
  total_calls: number;
  total_answered: number;
  overall_rate: number;
  buckets: AnswerRateBucket[];
}
export function answerRateByHourWeekday(
  campaignId: string,
  days = 30,
): AnswerRateSummary {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();
  const rows = db()
    .prepare(
      `SELECT
         CAST(strftime('%H', ts, 'localtime') AS INTEGER) AS hour,
         CAST(strftime('%w', ts, 'localtime') AS INTEGER) AS weekday,
         COUNT(*) AS total,
         SUM(CASE WHEN answered_at IS NOT NULL THEN 1 ELSE 0 END) AS answered
       FROM dial_intents
      WHERE campaign_id = ?
        AND kind != 'simulated'
        AND kind != 'originate_failed'
        AND ts >= ?
      GROUP BY hour, weekday
      ORDER BY weekday ASC, hour ASC`,
    )
    .all(campaignId, sinceIso) as Array<{
    hour: number;
    weekday: number;
    total: number;
    answered: number;
  }>;

  let totalCalls = 0;
  let totalAnswered = 0;
  const buckets: AnswerRateBucket[] = [];
  for (const r of rows) {
    totalCalls += r.total;
    totalAnswered += r.answered;
    buckets.push({
      hour: r.hour,
      weekday: r.weekday,
      total: r.total,
      answered: r.answered,
      answer_rate: r.total > 0 ? r.answered / r.total : -1,
    });
  }
  return {
    since_iso: sinceIso,
    total_calls: totalCalls,
    total_answered: totalAnswered,
    overall_rate: totalCalls > 0 ? totalAnswered / totalCalls : -1,
    buckets,
  };
}

/** Iter 132 — current-bucket lookup. The campaign-detail page
 * uses this to render "your dial_level may be {too high | too
 * low}" — comparing the recommended level (recommendDialLevel
 * below) to the campaign's configured level. Returns null when
 * the current (hour, weekday) bucket has zero recorded calls,
 * which a freshly-launched campaign will hit. */
export function answerRateForCurrentBucket(
  campaignId: string,
  days = 30,
  when: Date = new Date(),
): AnswerRateBucket | null {
  const hour = when.getHours();
  const weekday = when.getDay();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const row = db()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN answered_at IS NOT NULL THEN 1 ELSE 0 END) AS answered
       FROM dial_intents
      WHERE campaign_id = ?
        AND kind != 'simulated'
        AND kind != 'originate_failed'
        AND ts >= ?
        AND CAST(strftime('%H', ts, 'localtime') AS INTEGER) = ?
        AND CAST(strftime('%w', ts, 'localtime') AS INTEGER) = ?`,
    )
    .get(campaignId, since.toISOString(), hour, weekday) as {
    total: number;
    answered: number;
  };
  if (!row || row.total === 0) return null;
  return {
    hour,
    weekday,
    total: row.total,
    answered: row.answered,
    answer_rate: row.answered / row.total,
  };
}

/** Iter 132 — recommended dial_level given an answer rate.
 * Inverse curve matching ViciDial conventional wisdom: low
 * answer rate → dial harder to keep agents fed; high answer
 * rate → conservative to avoid abandons. Thresholds are
 * baked-in for v1; iter 133 makes them operator-tunable.
 *
 *   ≥ 50%   → 1.0  (1:1 power dial)
 *   25-50%  → 1.5
 *   15-25%  → 2.0
 *    5-15%  → 3.0
 *   < 5%    → 4.0  (aggressive predictive)
 *
 * Pass -1 (no data) for the conservative default. */
export function recommendDialLevel(answerRate: number): number {
  // Iter 134 — consult app_settings curve. The fallback default
  // mirrors the iter-132 hardcoded steps so deploys that never
  // open /settings/pacing keep the same behavior.
  if (answerRate < 0) return 1.0;
  const steps = getPacingThresholds();
  for (const s of steps) {
    if (answerRate >= s.min_rate) return s.dial_level;
  }
  // Should be unreachable because the lowest step is min_rate=0
  // (validated at write time), but be defensive.
  return steps[steps.length - 1]?.dial_level ?? 1.0;
}
/** Iter 99 — disposition breakdown for a single campaign since UTC
 * midnight. Driven by dial_intents.disposition (set when the agent
 * logs an outcome). Returns rows for the 7 ViciDial-style codes
 * the disposition module emits — zero counts are included so the
 * UI can render a stable 7-cell strip without filling gaps client-
 * side. Includes a synthetic "OPEN" bucket for connected calls
 * the agent hasn't dispositioned yet, so the operator sees the
 * wrap-up backlog at a glance. */
export interface CampaignDispositionRow {
  disposition: string;
  count: number;
}
const KNOWN_DISPOSITIONS = [
  'SALE',
  'CALLBACK',
  'NO_INTEREST',
  'ANSWERING_MACHINE',
  'VOICEMAIL_DROPPED',
  'SURVEYED',
  'WRONG_NUMBER',
  'BAD_NUMBER',
  'DNC',
] as const;
/** Iter 107 — inbound-whitelist lookup. When a customer dials our
 * outbound CID, the Kamailio dialplan calls this to decide if the
 * inbound is a recognised return-call (and which campaign owns
 * the context). We only match against leads whose status carries
 * positive contact signal — they've already heard from us — so a
 * cold inbound from a NEW lead doesn't get auto-routed to whoever
 * happens to own a list that contains the number.
 *
 * Returns the most-recently-touched matching lead with enough
 * context for the routing layer to decide:
 *   - lead_id + list_id + campaign_id of the campaign that last
 *     dialed this person (via dial_intents)
 *   - status (so the router can prefer SURVEYED → survey campaign,
 *     VM_PLAYED → original campaign, etc.)
 *   - last_called_at so very-stale matches can be ignored. */
export const INBOUND_WHITELIST_STATUSES = [
  'CALLBACK_SCHEDULED',
  'VM_PLAYED',
  'SURVEYED',
  'CALLED_NO_ANSWER',
] as const;
export interface InboundReturnMatch {
  lead_id: string;
  phone: string;
  list_id: string;
  status: string;
  last_called_at: string | null;
  last_campaign_id: string | null;
  last_campaign_name: string | null;
}
export function findInboundReturnMatch(
  phone: string,
): InboundReturnMatch | undefined {
  // Normalisation is caller-side. Phone here is the canonical
  // form already (matches the storage shape). Most-recent dial
  // wins: a number on multiple lists routes by who last spoke.
  const placeholders = INBOUND_WHITELIST_STATUSES.map(() => '?').join(',');
  return db()
    .prepare(
      `SELECT l.id   AS lead_id,
              l.phone,
              l.list_id,
              l.status,
              l.last_called_at,
              di.campaign_id AS last_campaign_id,
              c.name         AS last_campaign_name
         FROM leads l
         LEFT JOIN dial_intents di
                ON di.id = (
                  SELECT MAX(id) FROM dial_intents
                   WHERE lead_id = l.id AND kind != 'simulated'
                )
         LEFT JOIN campaigns c ON c.id = di.campaign_id
        WHERE l.phone = ?
          AND l.status IN (${placeholders})
        ORDER BY COALESCE(l.last_called_at, l.created_at) DESC
        LIMIT 1`,
    )
    .get(phone, ...INBOUND_WHITELIST_STATUSES) as
    | InboundReturnMatch
    | undefined;
}

/** Iter 104 — supervisor view of every callback scheduled on the
 * floor. Iter 19's pacer already picks these in priority order
 * (overdue first); this is the pure read surface so a supervisor
 * can see what's queued, what's overdue, and who is due in the
 * next hour without going through individual lead lists. Returns
 * up to `limit` rows ordered oldest-first (overdue at the top
 * matches what the operator actually needs to fix). */
export interface ScheduledCallbackRow {
  lead_id: string;
  phone: string;
  lead_name: string | null;
  callback_at: string;
  list_id: string;
  list_name: string;
  timezone: string | null;
}
export function listScheduledCallbacks(
  limit = 200,
): ScheduledCallbackRow[] {
  return db()
    .prepare(
      `SELECT l.id  AS lead_id,
              l.phone,
              l.name AS lead_name,
              l.callback_at,
              l.list_id,
              ll.name AS list_name,
              l.timezone
         FROM leads l
         JOIN lead_lists ll ON ll.id = l.list_id
        WHERE l.status = 'CALLBACK_SCHEDULED'
          AND l.callback_at IS NOT NULL
        ORDER BY l.callback_at ASC, l.created_at ASC
        LIMIT ?`,
    )
    .all(limit) as unknown as ScheduledCallbackRow[];
}

/** Iter 103 — floor-wide disposition mix. Same shape and zero-fill
 * semantics as campaignDispositionMix but aggregated across every
 * campaign. Drives the dashboard's "Today's outcomes" card so an
 * operator gets a single-glance read on what's actually happening
 * across the floor without drilling into individual campaigns. */
export function floorDispositionMixToday(): CampaignDispositionRow[] {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.toISOString();

  const counted = db()
    .prepare(
      `SELECT disposition AS d, COUNT(*) AS n
         FROM dial_intents
        WHERE kind != 'simulated'
          AND dispositioned_at IS NOT NULL
          AND dispositioned_at >= ?
        GROUP BY disposition`,
    )
    .all(since) as Array<{ d: string; n: number }>;

  const open = db()
    .prepare(
      `SELECT COUNT(*) AS n
         FROM dial_intents
        WHERE kind != 'simulated'
          AND answered_at IS NOT NULL
          AND dispositioned_at IS NULL
          AND ts >= ?`,
    )
    .get(since) as { n: number };

  const byKey = new Map<string, number>();
  for (const r of counted) byKey.set(r.d, r.n);

  const rows: CampaignDispositionRow[] = KNOWN_DISPOSITIONS.map((k) => ({
    disposition: k,
    count: byKey.get(k) ?? 0,
  }));
  for (const [d, n] of byKey) {
    if (!KNOWN_DISPOSITIONS.includes(d as (typeof KNOWN_DISPOSITIONS)[number])) {
      rows.push({ disposition: d, count: n });
    }
  }
  rows.push({ disposition: 'OPEN', count: open.n ?? 0 });
  return rows;
}

/* Iter 148 — generalised disposition mix: any time window, optionally
 * filtered by disposition_origin ('agent' / 'auto'). Returns rows
 * in {disposition, count} shape compatible with the existing
 * DispositionStrip renderer. NO synthetic OPEN bucket — the
 * /reports view is post-hoc, not a wrap-up reminder. Codes
 * unknown to KNOWN_DISPOSITIONS still appear (auto codes get
 * appended), so iter-146 codes show up without table changes. */
export function floorDispositionMixSince(
  sinceIso: string,
  origin?: 'agent' | 'auto' | null,
): CampaignDispositionRow[] {
  const where = [
    "kind != 'simulated'",
    'dispositioned_at IS NOT NULL',
    'dispositioned_at >= ?',
  ];
  const vals: unknown[] = [sinceIso];
  if (origin) {
    where.push('disposition_origin = ?');
    vals.push(origin);
  }
  const counted = db()
    .prepare(
      `SELECT disposition AS d, COUNT(*) AS n
         FROM dial_intents
        WHERE ${where.join(' AND ')}
        GROUP BY disposition
        ORDER BY n DESC`,
    )
    .all(...(vals as never[])) as Array<{ d: string; n: number }>;
  return counted.map((r) => ({ disposition: r.d, count: r.n }));
}

export function campaignDispositionMix(
  campaignId: string,
): CampaignDispositionRow[] {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.toISOString();

  const counted = db()
    .prepare(
      `SELECT disposition AS d, COUNT(*) AS n
         FROM dial_intents
        WHERE campaign_id = ?
          AND kind != 'simulated'
          AND dispositioned_at IS NOT NULL
          AND dispositioned_at >= ?
        GROUP BY disposition`,
    )
    .all(campaignId, since) as Array<{ d: string; n: number }>;

  const open = db()
    .prepare(
      `SELECT COUNT(*) AS n
         FROM dial_intents
        WHERE campaign_id = ?
          AND kind != 'simulated'
          AND answered_at IS NOT NULL
          AND dispositioned_at IS NULL
          AND ts >= ?`,
    )
    .get(campaignId, since) as { n: number };

  const byKey = new Map<string, number>();
  for (const r of counted) byKey.set(r.d, r.n);

  const rows: CampaignDispositionRow[] = KNOWN_DISPOSITIONS.map((k) => ({
    disposition: k,
    count: byKey.get(k) ?? 0,
  }));
  // Surface anything the schema doesn't know about (custom codes
  // added later) so the operator still sees them rather than us
  // silently dropping the bucket.
  for (const [d, n] of byKey) {
    if (!KNOWN_DISPOSITIONS.includes(d as (typeof KNOWN_DISPOSITIONS)[number])) {
      rows.push({ disposition: d, count: n });
    }
  }
  rows.push({ disposition: 'OPEN', count: open.n ?? 0 });
  return rows;
}

/** Iter 98 — single-shot scoreboard for the agent's own console.
 * Bundles today's call/talk/dispo aggregates with the current
 * live status (AVAILABLE / PAUSED / WRAP-UP) and the in-flight
 * call (if any) so /agent's stat row can drop the stale "—"
 * placeholders that read "Bridge from pacer TBD" / "Disposition
 * flow TBD". One SQL pass for the aggregates + one for the live
 * call lookup; cheaper than fanning out four separate queries on
 * every page hit. */
export interface AgentTodayScoreboard {
  status: string;
  pause_reason: string | null;
  current_intent_id: number | null;
  current_phone: string | null;
  current_answered_at: string | null;
  calls_today: number;
  talked_today: number;
  talk_time_ms_today: number;
  dispositions_today: number;
}
export function agentTodayScoreboard(userId: string): AgentTodayScoreboard {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.toISOString();
  const d = db();

  const agg = d
    .prepare(
      `SELECT
         COUNT(*) AS calls_today,
         SUM(CASE WHEN answered_at IS NOT NULL THEN 1 ELSE 0 END) AS talked_today,
         COALESCE(SUM(CASE WHEN answered_at IS NOT NULL THEN duration_ms ELSE 0 END), 0)
           AS talk_time_ms_today,
         SUM(CASE WHEN dispositioned_at IS NOT NULL AND dispositioned_at >= ?
                  THEN 1 ELSE 0 END) AS dispositions_today
       FROM dial_intents
       WHERE assigned_user_id = ?
         AND kind != 'simulated'
         AND ts >= ?`,
    )
    .get(since, userId, since) as {
    calls_today: number;
    talked_today: number;
    talk_time_ms_today: number;
    dispositions_today: number;
  };

  const status = d
    .prepare(
      `SELECT COALESCE(s.status, 'AVAILABLE') AS status, s.reason
         FROM users u
         LEFT JOIN agent_status s ON s.user_id = u.id
        WHERE u.id = ?`,
    )
    .get(userId) as { status: string; reason: string | null } | undefined;

  const live = d
    .prepare(
      `SELECT id, transformed_phone, answered_at
         FROM dial_intents
        WHERE assigned_user_id = ?
          AND answered_at IS NOT NULL
          AND hangup_at IS NULL
          AND call_uuid IS NOT NULL
        ORDER BY id DESC
        LIMIT 1`,
    )
    .get(userId) as
    | { id: number; transformed_phone: string | null; answered_at: string }
    | undefined;

  return {
    status: status?.status ?? 'AVAILABLE',
    pause_reason: status?.reason ?? null,
    current_intent_id: live?.id ?? null,
    current_phone: live?.transformed_phone ?? null,
    current_answered_at: live?.answered_at ?? null,
    calls_today: agg.calls_today ?? 0,
    talked_today: agg.talked_today ?? 0,
    talk_time_ms_today: agg.talk_time_ms_today ?? 0,
    dispositions_today: agg.dispositions_today ?? 0,
  };
}

/**
 * Pacing's lead picker.
 *
 * Iter 19 — schedule-aware. Two passes, callbacks first:
 *   Pass 1: CALLBACK_SCHEDULED leads whose callback_at is in the past
 *           (oldest scheduled time wins — agent shouldn't be late)
 *   Pass 2: NEW + CALLED_NO_ANSWER leads, gated by the per-tick cooldown
 *
 * If a CALLBACK_SCHEDULED lead has a NULL callback_at (legacy data, or
 * a future one not yet due) it stays out of the queue — never picked
 * accidentally, never picked early.
 */
export function pickNextDialableLead(
  campaignId: string,
  cooldownSeconds: number,
): { lead_id: string; list_id: string; phone: string; name: string | null } | undefined {
  const now = new Date().toISOString();
  const cooldownCutoff = new Date(
    Date.now() - cooldownSeconds * 1000,
  ).toISOString();
  const d = db();

  // Iter 23 — lists belong to a campaign directly via lead_lists.campaign_id.
  const callback = d
    .prepare(
      `SELECT l.id AS lead_id, l.list_id, l.phone, l.name
       FROM leads l
       JOIN lead_lists ll ON ll.id = l.list_id
       WHERE ll.campaign_id = ?
         AND l.status = 'CALLBACK_SCHEDULED'
         AND l.callback_at IS NOT NULL
         AND l.callback_at <= ?
       ORDER BY l.callback_at ASC, l.created_at ASC
       LIMIT 1`,
    )
    .get(campaignId, now) as
    | { lead_id: string; list_id: string; phone: string; name: string | null }
    | undefined;
  if (callback) return callback;

  return d
    .prepare(
      `SELECT l.id AS lead_id, l.list_id, l.phone, l.name
       FROM leads l
       JOIN lead_lists ll ON ll.id = l.list_id
       WHERE ll.campaign_id = ?
         AND l.status IN ('NEW', 'CALLED_NO_ANSWER', 'BUSY')
         AND (l.last_called_at IS NULL OR l.last_called_at < ?)
       ORDER BY CASE WHEN l.last_called_at IS NULL THEN 0 ELSE 1 END,
                l.last_called_at ASC,
                l.created_at ASC
       LIMIT 1`,
    )
    .get(campaignId, cooldownCutoff) as
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

/**
 * Iter 34 — only update lead.status when its CURRENT status is in
 * `expectedStatuses`. Used by fs-events to write the carrier-derived
 * outcome onto a lead that's still 'DIALING'. If an agent dispositioned
 * during the call, status is no longer DIALING and we leave it alone.
 *
 * Also used to look up the lead from a dial_intent's correlation_id —
 * the call-outcome mapping is per-call, but we apply it to the LEAD
 * the call was for.
 */
export function setLeadStatusIfIn(
  leadId: string,
  newStatus: string,
  expectedStatuses: string[],
): boolean {
  if (expectedStatuses.length === 0) return false;
  const placeholders = expectedStatuses.map(() => '?').join(',');
  const result = db()
    .prepare(
      `UPDATE leads
         SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status IN (${placeholders})`,
    )
    .run(newStatus, leadId, ...expectedStatuses);
  return Number(result.changes) > 0;
}

export function getLeadIdForCorrelation(
  correlationId: string,
): { lead_id: string; current_lead_status: string | null } | undefined {
  return db()
    .prepare(
      `SELECT i.lead_id AS lead_id, l.status AS current_lead_status
         FROM dial_intents i
         LEFT JOIN leads l ON l.id = i.lead_id
        WHERE i.correlation_id = ?`,
    )
    .get(correlationId) as
    | { lead_id: string; current_lead_status: string | null }
    | undefined;
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

/* Iter 150 — Sound Board (audio library) DB ops. Files are stored
 * on disk under /var/lib/dialeros/audio/library/<id>.wav; this
 * table indexes them with operator-facing metadata.
 */
export interface AudioFileRecord {
  id: string;
  name: string;
  description: string | null;
  category: string;
  path: string;
  source: string;
  duration_ms: number | null;
  size_bytes: number;
  created_at: string;
  updated_at: string;
  created_by_user_id: string | null;
}

export function insertAudioFile(rec: {
  id: string;
  name: string;
  description: string | null;
  category: string;
  path: string;
  source: string;
  duration_ms: number | null;
  size_bytes: number;
  created_by_user_id: string | null;
}): void {
  db()
    .prepare(
      `INSERT INTO audio_files (
         id, name, description, category, path, source,
         duration_ms, size_bytes, created_by_user_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.id,
      rec.name,
      rec.description,
      rec.category,
      rec.path,
      rec.source,
      rec.duration_ms,
      rec.size_bytes,
      rec.created_by_user_id,
    );
}

export function listAudioFilesFromDb(
  category?: string,
): AudioFileRecord[] {
  if (category) {
    return db()
      .prepare(
        `SELECT * FROM audio_files
          WHERE category = ?
          ORDER BY name ASC`,
      )
      .all(category) as unknown as AudioFileRecord[];
  }
  return db()
    .prepare(`SELECT * FROM audio_files ORDER BY name ASC`)
    .all() as unknown as AudioFileRecord[];
}

export function getAudioFileFromDb(
  id: string,
): AudioFileRecord | undefined {
  return db()
    .prepare(`SELECT * FROM audio_files WHERE id = ?`)
    .get(id) as unknown as AudioFileRecord | undefined;
}

export function deleteAudioFileFromDb(id: string): boolean {
  const result = db()
    .prepare(`DELETE FROM audio_files WHERE id = ?`)
    .run(id);
  return Number(result.changes) > 0;
}

/* Iter 149 — Call Menu DB ops.
 *
 * Two tables, simple relational shape. Options are replaced
 * wholesale on update (delete-all-then-insert) so the admin UI
 * can edit the option grid as a single form post without
 * juggling individual create/update/delete option calls.
 */
export interface CallMenuRecord {
  id: string;
  name: string;
  description: string | null;
  prompt_path: string | null;
  prompt_tts_text: string | null;
  timeout_seconds: number;
  max_retries: number;
  invalid_audio_path: string | null;
  timeout_audio_path: string | null;
  default_action_type: string;
  default_action_value: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallMenuOptionRecord {
  id: number;
  call_menu_id: string;
  digit: string;
  ordering: number;
  action_type: string;
  action_value: string | null;
  label: string | null;
}

export function insertCallMenu(rec: {
  id: string;
  name: string;
  description: string | null;
  prompt_path: string | null;
  prompt_tts_text: string | null;
  timeout_seconds: number;
  max_retries: number;
  invalid_audio_path: string | null;
  timeout_audio_path: string | null;
  default_action_type: string;
  default_action_value: string | null;
}): void {
  db()
    .prepare(
      `INSERT INTO call_menus (
         id, name, description, prompt_path, prompt_tts_text,
         timeout_seconds, max_retries,
         invalid_audio_path, timeout_audio_path,
         default_action_type, default_action_value
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.id,
      rec.name,
      rec.description,
      rec.prompt_path,
      rec.prompt_tts_text,
      rec.timeout_seconds,
      rec.max_retries,
      rec.invalid_audio_path,
      rec.timeout_audio_path,
      rec.default_action_type,
      rec.default_action_value,
    );
}

export function listCallMenusFromDb(): CallMenuRecord[] {
  return db()
    .prepare(`SELECT * FROM call_menus ORDER BY name ASC`)
    .all() as unknown as CallMenuRecord[];
}

export function getCallMenuFromDb(
  id: string,
): CallMenuRecord | undefined {
  return db()
    .prepare(`SELECT * FROM call_menus WHERE id = ?`)
    .get(id) as unknown as CallMenuRecord | undefined;
}

export function updateCallMenuFields(
  id: string,
  fields: {
    name: string;
    description: string | null;
    prompt_path: string | null;
    prompt_tts_text: string | null;
    timeout_seconds: number;
    max_retries: number;
    invalid_audio_path: string | null;
    timeout_audio_path: string | null;
    default_action_type: string;
    default_action_value: string | null;
  },
): boolean {
  const result = db()
    .prepare(
      `UPDATE call_menus
          SET name = ?, description = ?,
              prompt_path = ?, prompt_tts_text = ?,
              timeout_seconds = ?, max_retries = ?,
              invalid_audio_path = ?, timeout_audio_path = ?,
              default_action_type = ?, default_action_value = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .run(
      fields.name,
      fields.description,
      fields.prompt_path,
      fields.prompt_tts_text,
      fields.timeout_seconds,
      fields.max_retries,
      fields.invalid_audio_path,
      fields.timeout_audio_path,
      fields.default_action_type,
      fields.default_action_value,
      id,
    );
  return Number(result.changes) > 0;
}

export function deleteCallMenuFromDb(id: string): boolean {
  const result = db()
    .prepare(`DELETE FROM call_menus WHERE id = ?`)
    .run(id);
  return Number(result.changes) > 0;
}

export function listCallMenuOptionsFromDb(
  callMenuId: string,
): CallMenuOptionRecord[] {
  return db()
    .prepare(
      `SELECT * FROM call_menu_options
        WHERE call_menu_id = ?
        ORDER BY ordering ASC, digit ASC`,
    )
    .all(callMenuId) as unknown as CallMenuOptionRecord[];
}

export function replaceCallMenuOptions(
  callMenuId: string,
  options: Array<{
    digit: string;
    ordering: number;
    action_type: string;
    action_value: string | null;
    label: string | null;
  }>,
): void {
  const conn = db();
  const tx = conn.exec.bind(conn);
  tx('BEGIN');
  try {
    conn
      .prepare(`DELETE FROM call_menu_options WHERE call_menu_id = ?`)
      .run(callMenuId);
    if (options.length > 0) {
      const stmt = conn.prepare(
        `INSERT INTO call_menu_options
           (call_menu_id, digit, ordering, action_type, action_value, label)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const opt of options) {
        stmt.run(
          callMenuId,
          opt.digit,
          opt.ordering,
          opt.action_type,
          opt.action_value,
          opt.label,
        );
      }
    }
    tx('COMMIT');
  } catch (e) {
    tx('ROLLBACK');
    throw e;
  }
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

/**
 * Iter 22 — list all DIDs across every in-group with their owner. Used
 * by the standalone /dids page so admins don't have to hunt through
 * each in-group to find a number.
 */
export interface DidWithOwner {
  did: string;
  in_group_id: string;
  in_group_name: string;
  in_group_enabled: number;
}

export function listAllDids(): DidWithOwner[] {
  return db()
    .prepare(
      `SELECT igd.did, igd.in_group_id,
              ig.name AS in_group_name, ig.enabled AS in_group_enabled
         FROM in_group_dids igd
         JOIN in_groups ig ON ig.id = igd.in_group_id
        ORDER BY igd.did ASC`,
    )
    .all() as unknown as DidWithOwner[];
}

export function getDidWithOwner(did: string): DidWithOwner | undefined {
  return db()
    .prepare(
      `SELECT igd.did, igd.in_group_id,
              ig.name AS in_group_name, ig.enabled AS in_group_enabled
         FROM in_group_dids igd
         JOIN in_groups ig ON ig.id = igd.in_group_id
        WHERE igd.did = ?`,
    )
    .get(did) as unknown as DidWithOwner | undefined;
}

export function reassignDidToInGroup(
  did: string,
  newInGroupId: string,
): boolean {
  const result = db()
    .prepare(
      `UPDATE in_group_dids SET in_group_id = ? WHERE did = ?`,
    )
    .run(newInGroupId, did);
  return Number(result.changes) > 0;
}

export function deleteDid(did: string): boolean {
  const result = db()
    .prepare(`DELETE FROM in_group_dids WHERE did = ?`)
    .run(did);
  return Number(result.changes) > 0;
}

/** Iter 114 + iter 115 — pick a single available agent for an in-
 * group's inbound call. Joins user_in_groups × users × phones +
 * filters to active, AVAILABLE, not bridged. iter 115 added per-
 * strategy ordering:
 *   - longest_idle: ORDER BY agent_status.updated_at ASC. Best
 *     fairness — the agent who's been idle longest gets the call.
 *   - random:       ORDER BY RANDOM(). Useful for QA / load
 *     balancing without sticky bias.
 *   - ring_all:     Kamailio's true fork-ringing path needs a
 *     list of every available extension. iter 116 implements
 *     that by returning an array; for now the picker degrades
 *     to longest_idle so the existing single-target wire still
 *     works.
 *
 * Returns undefined when no agent is reachable; caller decides
 * whether to queue, fast-busy, or park. */
export interface InGroupAgentPick {
  user_id: string;
  username: string;
  extension: string;
}
export function pickAvailableAgentForInGroup(
  inGroupId: string,
  strategy: 'ring_all' | 'longest_idle' | 'random' = 'longest_idle',
): InGroupAgentPick | undefined {
  const orderClause =
    strategy === 'random'
      ? 'ORDER BY RANDOM()'
      : // ring_all (degrades) + longest_idle both use updated_at ASC.
        // NULL updated_at (never set a status) sorts oldest so a
        // freshly-signed-in agent gets priority over a stale
        // PAUSED→AVAILABLE cycle from earlier.
        "ORDER BY COALESCE(s.updated_at, '1970-01-01') ASC";

  return db()
    .prepare(
      `SELECT u.id   AS user_id,
              u.username,
              p.extension
         FROM user_in_groups uig
         JOIN users u ON u.id = uig.user_id
         JOIN phones p ON p.user_id = u.id AND p.is_primary = 1
         LEFT JOIN agent_status s ON s.user_id = u.id
        WHERE uig.in_group_id = ?
          AND u.is_active = 1
          AND COALESCE(s.status, 'AVAILABLE') = 'AVAILABLE'
          AND NOT EXISTS (
            SELECT 1 FROM dial_intents di
             WHERE di.assigned_user_id = u.id
               AND di.answered_at IS NOT NULL
               AND di.hangup_at IS NULL
               AND di.kind != 'simulated'
          )
        ${orderClause}
        LIMIT 1`,
    )
    .get(inGroupId) as InGroupAgentPick | undefined;
}

/** Iter 116 — inbound call queue state machine. When the inbound-
 * route endpoint can't find an agent for an in-group, the call
 * is parked in the FS queue extension; we persist the wait here
 * so:
 *   1. The FS queue extension can poll /api/internal/queue-poll
 *      and bridge as soon as an agent becomes available.
 *   2. The supervisor /supervisor view can see who's waiting
 *      and how long.
 *   3. iter 117's expiry sweeper can age out stuck rows when FS
 *      misses the dispatched/expired callback.
 *
 * enqueueInboundCall is idempotent on the call_id so Kamailio's
 * retry behavior doesn't fork duplicate rows. */
export interface InboundQueueRow {
  id: string;
  call_id: string;
  from_phone: string;
  to_phone: string;
  in_group_id: string;
  classification: string | null;
  lead_id: string | null;
  enqueued_at: string;
  dispatched_at: string | null;
  dispatched_to_user_id: string | null;
  dispatched_extension: string | null;
  expired_at: string | null;
  expire_reason: string | null;
}

export function enqueueInboundCall(args: {
  callId: string;
  fromPhone: string;
  toPhone: string;
  inGroupId: string;
  classification: string | null;
  leadId: string | null;
}): InboundQueueRow {
  const id = randomUUID();
  const d = db();
  d.prepare(
    `INSERT INTO inbound_queue (
       id, call_id, from_phone, to_phone, in_group_id, classification, lead_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(call_id) DO NOTHING`,
  ).run(
    id,
    args.callId,
    args.fromPhone,
    args.toPhone,
    args.inGroupId,
    args.classification,
    args.leadId,
  );
  // Read back — when ON CONFLICT fires, the row already exists
  // with whatever id it was first assigned; return that.
  return d
    .prepare(`SELECT * FROM inbound_queue WHERE call_id = ?`)
    .get(args.callId) as unknown as InboundQueueRow;
}

export function getQueuedCallByCallId(
  callId: string,
): InboundQueueRow | undefined {
  return db()
    .prepare(`SELECT * FROM inbound_queue WHERE call_id = ?`)
    .get(callId) as unknown as InboundQueueRow | undefined;
}

/** Mark a queued row as dispatched to an agent. Idempotent on a
 * row that's already been dispatched — caller is expected to
 * re-check the result and bridge based on the now-set extension. */
export function dispatchQueuedCall(
  callId: string,
  userId: string,
  extension: string,
): boolean {
  const result = db()
    .prepare(
      `UPDATE inbound_queue
          SET dispatched_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              dispatched_to_user_id = ?,
              dispatched_extension = ?
        WHERE call_id = ?
          AND dispatched_at IS NULL
          AND expired_at IS NULL`,
    )
    .run(userId, extension, callId);
  return Number(result.changes) > 0;
}

export function expireQueuedCall(callId: string, reason: string): boolean {
  const result = db()
    .prepare(
      `UPDATE inbound_queue
          SET expired_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              expire_reason = ?
        WHERE call_id = ?
          AND expired_at IS NULL`,
    )
    .run(reason, callId);
  return Number(result.changes) > 0;
}

/** Supervisor view — every currently-waiting caller. expired_at
 * IS NULL means "still on hold or just got an agent assigned but
 * the bridge hasn't fully completed". dispatched_at distinguishes
 * "waiting" from "ringing the agent now". */
export interface SupervisorQueueRow {
  id: string;
  call_id: string;
  from_phone: string;
  to_phone: string;
  in_group_id: string;
  in_group_name: string;
  classification: string | null;
  enqueued_at: string;
  dispatched_at: string | null;
  dispatched_extension: string | null;
}
export function listActiveQueuedCalls(): SupervisorQueueRow[] {
  return db()
    .prepare(
      `SELECT q.id, q.call_id, q.from_phone, q.to_phone,
              q.in_group_id, ig.name AS in_group_name,
              q.classification, q.enqueued_at,
              q.dispatched_at, q.dispatched_extension
         FROM inbound_queue q
         JOIN in_groups ig ON ig.id = q.in_group_id
        WHERE q.expired_at IS NULL
        ORDER BY q.enqueued_at ASC`,
    )
    .all() as unknown as SupervisorQueueRow[];
}

/** iter 116 — sweep stale queue rows. FS or Kamailio missing the
 * callback would otherwise leave rows pinned forever. Default
 * 10-minute ceiling; supervisor max_wait_seconds (on the in_group
 * record) is a soft hint and iter 117 wires the per-in_group
 * timeout through this same path. Returns the count expired. */
export function expireStaleQueuedCalls(maxAgeSeconds = 600): number {
  const cutoff = new Date(Date.now() - maxAgeSeconds * 1000).toISOString();
  const result = db()
    .prepare(
      `UPDATE inbound_queue
          SET expired_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              expire_reason = 'stale_timeout'
        WHERE expired_at IS NULL
          AND enqueued_at < ?`,
    )
    .run(cutoff);
  return Number(result.changes);
}

/** Iter 130 — pause-reason analytics. Walks audit_events for
 * agent.paused / agent.resumed and pairs each paused event with
 * the next resumed event for the same actor, computing duration.
 * Aggregates by the paused event's reason from payload_json.
 *
 * Sort by total time so the reason eating most of the floor's
 * shift-hours surfaces first. Per-user variant lives in
 * pauseAnalyticsForUser for the /users/[id] view.
 *
 * Unmatched paused events (still on pause at the end of the
 * window) are excluded from average duration — counting "since
 * 30min ago to right now" as a completed pause would bias the
 * mean down on every refresh. Their existence is reported as
 * `still_paused`. */
export interface PauseReasonRow {
  reason: string;
  count: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  agents_affected: number;
  still_paused: number;
}
export function pauseReasonAnalytics(
  sinceIso: string,
  actorUserId: string | null = null,
): PauseReasonRow[] {
  const where: string[] = [
    "action IN ('agent.paused', 'agent.resumed')",
    'ts >= ?',
  ];
  const values: unknown[] = [sinceIso];
  if (actorUserId) {
    where.push('actor_user_id = ?');
    values.push(actorUserId);
  }
  const rows = db()
    .prepare(
      `SELECT actor_user_id, action, ts, payload_json
         FROM audit_events
        WHERE ${where.join(' AND ')}
        ORDER BY actor_user_id ASC, ts ASC, id ASC`,
    )
    .all(...(values as never[])) as Array<{
    actor_user_id: string | null;
    action: string;
    ts: string;
    payload_json: string | null;
  }>;

  // Pair paused → resumed per user.
  interface Pending {
    reason: string;
    ts: number;
  }
  const pending = new Map<string, Pending>(); // user_id → open pause
  type Agg = {
    count: number;
    total_duration_ms: number;
    agents_affected: Set<string>;
    still_paused: number;
  };
  const agg = new Map<string, Agg>();
  function bumpAgg(reason: string): Agg {
    let r = agg.get(reason);
    if (!r) {
      r = {
        count: 0,
        total_duration_ms: 0,
        agents_affected: new Set(),
        still_paused: 0,
      };
      agg.set(reason, r);
    }
    return r;
  }
  for (const ev of rows) {
    if (!ev.actor_user_id) continue;
    const userId = ev.actor_user_id;
    if (ev.action === 'agent.paused') {
      // If a prior paused never got a resumed (e.g. agent
      // double-paused without resuming — shouldn't happen but
      // be defensive), bump the previous one as still_paused
      // before overwriting.
      const prev = pending.get(userId);
      if (prev) {
        const slot = bumpAgg(prev.reason);
        slot.still_paused++;
        slot.count++;
        slot.agents_affected.add(userId);
      }
      let reason = 'unspecified';
      try {
        const p = ev.payload_json
          ? (JSON.parse(ev.payload_json) as { reason?: unknown })
          : {};
        if (typeof p.reason === 'string' && p.reason.length > 0) {
          reason = p.reason;
        }
      } catch {
        /* malformed payload — fall back to "unspecified" */
      }
      pending.set(userId, { reason, ts: Date.parse(ev.ts) });
    } else if (ev.action === 'agent.resumed') {
      const open = pending.get(userId);
      if (!open) continue;
      pending.delete(userId);
      const slot = bumpAgg(open.reason);
      slot.count++;
      slot.agents_affected.add(userId);
      slot.total_duration_ms += Math.max(0, Date.parse(ev.ts) - open.ts);
    }
  }
  // Account for currently-still-paused agents — they DO count
  // toward the floor-time analytics but only as in-flight, not
  // completed pauses.
  for (const [userId, open] of pending) {
    const slot = bumpAgg(open.reason);
    slot.count++;
    slot.agents_affected.add(userId);
    slot.still_paused++;
  }

  const out: PauseReasonRow[] = [];
  for (const [reason, a] of agg) {
    const completed = a.count - a.still_paused;
    out.push({
      reason,
      count: a.count,
      total_duration_ms: a.total_duration_ms,
      avg_duration_ms:
        completed > 0 ? Math.round(a.total_duration_ms / completed) : 0,
      agents_affected: a.agents_affected.size,
      still_paused: a.still_paused,
    });
  }
  out.sort((a, b) => b.total_duration_ms - a.total_duration_ms);
  return out;
}

/** Iter 122 — AMD result breakdown for a campaign since UTC
 * midnight. Only counts non-simulated rows that actually ran AMD
 * (amd_result IS NOT NULL). The four expected codes match
 * mod_amd_v2's output:
 *   HUMAN     — connected, voice detected
 *   MACHINE   — connected, answering-machine detected
 *   NOTSURE   — ambiguous; pacer treats as HUMAN to avoid
 *               dropping real callers
 *   UNKNOWN   — amd_v2 finished without a verdict (rare)
 * Plus a synthetic NO_AMD bucket counting answered calls on the
 * campaign that did NOT run AMD — useful for spotting a
 * misconfigured amd_action mid-shift. Zero counts are included so
 * the realtime card renders a stable 5-cell strip. */
export interface AmdBreakdownRow {
  amd_result: string;
  count: number;
}
const AMD_CODES = ['HUMAN', 'MACHINE', 'NOTSURE', 'UNKNOWN'] as const;
export function amdBreakdownForCampaignToday(
  campaignId: string,
): AmdBreakdownRow[] {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.toISOString();

  const counted = db()
    .prepare(
      `SELECT amd_result AS r, COUNT(*) AS n
         FROM dial_intents
        WHERE campaign_id = ?
          AND kind != 'simulated'
          AND amd_result IS NOT NULL
          AND ts >= ?
        GROUP BY amd_result`,
    )
    .all(campaignId, since) as Array<{ r: string; n: number }>;

  const noAmd = db()
    .prepare(
      `SELECT COUNT(*) AS n
         FROM dial_intents
        WHERE campaign_id = ?
          AND kind != 'simulated'
          AND answered_at IS NOT NULL
          AND amd_result IS NULL
          AND ts >= ?`,
    )
    .get(campaignId, since) as { n: number };

  const byKey = new Map<string, number>();
  for (const r of counted) byKey.set(r.r, r.n);

  const rows: AmdBreakdownRow[] = AMD_CODES.map((k) => ({
    amd_result: k,
    count: byKey.get(k) ?? 0,
  }));
  // Surface unknown / custom amd_result strings that don't match
  // the four we know about — avoids silent data loss if mod_amd_v2
  // ever introduces a new code or the dialplan starts writing one.
  for (const [r, n] of byKey) {
    if (!AMD_CODES.includes(r as (typeof AMD_CODES)[number])) {
      rows.push({ amd_result: r, count: n });
    }
  }
  rows.push({ amd_result: 'NO_AMD', count: noAmd.n ?? 0 });
  return rows;
}

/** Iter 117 — plural picker for true ring_all fork-ringing.
 * Returns up to `limit` available agents in the in-group, ordered
 * by strategy. Kamailio's dialplan loops over the result and
 * append_branch()es each target so the customer's INVITE forks
 * to every agent simultaneously; first to answer wins, the rest
 * get a CANCEL. ring_all should keep limit < ~10 — beyond that
 * carriers start refusing the forked SDP and FS RAM grows quickly.
 *
 * Returns [] when no agent is available — caller falls back to
 * the queue branch same as the singular picker. */
export function pickAvailableAgentsForInGroup(
  inGroupId: string,
  strategy: 'ring_all' | 'longest_idle' | 'random',
  limit = 8,
): InGroupAgentPick[] {
  const orderClause =
    strategy === 'random'
      ? 'ORDER BY RANDOM()'
      : "ORDER BY COALESCE(s.updated_at, '1970-01-01') ASC";
  return db()
    .prepare(
      `SELECT u.id   AS user_id,
              u.username,
              p.extension
         FROM user_in_groups uig
         JOIN users u ON u.id = uig.user_id
         JOIN phones p ON p.user_id = u.id AND p.is_primary = 1
         LEFT JOIN agent_status s ON s.user_id = u.id
        WHERE uig.in_group_id = ?
          AND u.is_active = 1
          AND COALESCE(s.status, 'AVAILABLE') = 'AVAILABLE'
          AND NOT EXISTS (
            SELECT 1 FROM dial_intents di
             WHERE di.assigned_user_id = u.id
               AND di.answered_at IS NOT NULL
               AND di.hangup_at IS NULL
               AND di.kind != 'simulated'
          )
        ${orderClause}
        LIMIT ?`,
    )
    .all(inGroupId, limit) as unknown as InGroupAgentPick[];
}

/** Iter 115 — supervisor inbound monitor. Reads audit_events for
 * the inbound.forwarded / inbound.queued / inbound.rejected
 * actions (the inbound-route endpoint writes these on every
 * Kamailio decision). Returns the most-recent `limit` decisions
 * with their JSON payload parsed for the supervisor /supervisor
 * card. Cheap — audit_events is indexed by ts DESC. */
export interface InboundDecisionRow {
  ts: string;
  action: string;
  target_in_group_id: string | null;
  from_phone: string | null;
  to_phone: string | null;
  classification: string | null;
  agent_extension: string | null;
  lead_id: string | null;
}
export function listRecentInboundDecisions(
  limit = 50,
): InboundDecisionRow[] {
  const rows = db()
    .prepare(
      `SELECT ts, action, target_id, payload_json
         FROM audit_events
        WHERE action IN ('inbound.forwarded', 'inbound.queued')
        ORDER BY ts DESC
        LIMIT ?`,
    )
    .all(limit) as Array<{
    ts: string;
    action: string;
    target_id: string | null;
    payload_json: string | null;
  }>;
  return rows.map((r) => {
    let payload: Record<string, unknown> = {};
    if (r.payload_json) {
      try {
        payload = JSON.parse(r.payload_json) as Record<string, unknown>;
      } catch {
        /* drop malformed payloads silently — surface ts + action */
      }
    }
    return {
      ts: r.ts,
      action: r.action,
      target_in_group_id: r.target_id,
      from_phone: (payload.from as string) ?? null,
      to_phone: (payload.to as string) ?? null,
      classification: (payload.reason as string) ?? null,
      agent_extension: (payload.agent_extension as string) ?? null,
      lead_id: (payload.lead_id as string) ?? null,
    };
  });
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
  dial_mode: string;
  hopper_level: number;
  dial_level: number;
  amd_action: string;
  voicemail_path: string | null;
  list_order: string;
  /** Iter 94 — JSON array of lead statuses the pacer is allowed
   * to dial. Whitelist; anything not in here gets ignored on hopper
   * refill. Default
   * `["NEW","CALLED_NO_ANSWER","BUSY"]`. */
  dialable_statuses: string;
  // Iter 140 — JSON override of wait-for-beep dialplan params.
  // NULL = use the iter-139 baked-in defaults.
  voicemail_config: string | null;
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
  dial_mode?: string;
}): void {
  db()
    .prepare(
      `INSERT INTO campaigns (
        id, name, description, type, route_plan_id,
        base_ratio, call_window_start, call_window_end, max_abandon_pct,
        dial_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      rec.dial_mode ?? 'simulated',
    );
}

/**
 * Iter 23 — attach lead lists to a campaign. The relationship is
 * one-to-many (each list lives in at most one campaign), so this is
 * an UPDATE of the list row, not an INSERT into a join table. Stealing
 * a list from another campaign is intentional ("move"), audited by the
 * caller.
 */
export function attachCampaignLeadLists(
  campaignId: string,
  leadListIds: string[],
): void {
  if (leadListIds.length === 0) return;
  const stmt = db().prepare(
    `UPDATE lead_lists SET campaign_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  );
  for (const lid of leadListIds) {
    stmt.run(campaignId, lid);
  }
}

export function moveLeadListToCampaign(
  leadListId: string,
  campaignId: string | null,
): boolean {
  const result = db()
    .prepare(
      `UPDATE lead_lists SET campaign_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .run(campaignId, leadListId);
  return Number(result.changes) > 0;
}

/**
 * Iter 24 — atomic replace for the campaign's lead-list set. Diffs the
 * desired set against the current attachment, in one transaction:
 *   - lists currently attached but not in the new set → detach (campaign_id=NULL)
 *   - lists in the new set but not currently attached → attach (campaign_id=this)
 * Lists already attached and still in the new set are left alone (no-op
 * UPDATE skipped to keep updated_at honest).
 *
 * Stealing from another campaign is intentional — pass the same list id
 * here from a campaign that didn't previously own it and the list moves.
 */
export function setCampaignLeadLists(
  campaignId: string,
  leadListIds: string[],
): { detached: number; attached: number; moved: number } {
  const d = db();
  const desired = new Set(leadListIds);

  const currentlyAttached = (d
    .prepare(
      `SELECT id FROM lead_lists WHERE campaign_id = ?`,
    )
    .all(campaignId) as Array<{ id: string }>).map((r) => r.id);
  const currentSet = new Set(currentlyAttached);

  const toDetach = currentlyAttached.filter((id) => !desired.has(id));
  const toAttach = leadListIds.filter((id) => !currentSet.has(id));

  d.exec('BEGIN');
  let moved = 0;
  try {
    if (toDetach.length > 0) {
      const stmt = d.prepare(
        `UPDATE lead_lists SET campaign_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      );
      for (const id of toDetach) stmt.run(id);
    }
    if (toAttach.length > 0) {
      // Count how many were stolen from another campaign for the audit payload.
      const wasOwned = d.prepare(
        `SELECT campaign_id FROM lead_lists WHERE id = ?`,
      );
      const stmt = d.prepare(
        `UPDATE lead_lists SET campaign_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      );
      for (const id of toAttach) {
        const owner = wasOwned.get(id) as { campaign_id: string | null } | undefined;
        if (owner?.campaign_id && owner.campaign_id !== campaignId) moved++;
        stmt.run(campaignId, id);
      }
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return { detached: toDetach.length, attached: toAttach.length, moved };
}

export function listLeadListsForCampaign(
  campaignId: string,
): LeadListRecord[] {
  return db()
    .prepare(
      `SELECT * FROM lead_lists WHERE campaign_id = ? ORDER BY created_at ASC`,
    )
    .all(campaignId) as unknown as LeadListRecord[];
}

// ----- iter 21: campaign ↔ in-group -----

export function attachCampaignInGroups(
  campaignId: string,
  inGroupIds: string[],
): void {
  if (inGroupIds.length === 0) return;
  const stmt = db().prepare(
    `INSERT OR IGNORE INTO campaign_in_groups (campaign_id, in_group_id) VALUES (?, ?)`,
  );
  for (const gid of inGroupIds) stmt.run(campaignId, gid);
}

export function getCampaignInGroupIds(campaignId: string): string[] {
  return (db()
    .prepare(
      `SELECT in_group_id FROM campaign_in_groups WHERE campaign_id = ? ORDER BY in_group_id ASC`,
    )
    .all(campaignId) as unknown as Array<{ in_group_id: string }>).map(
    (r) => r.in_group_id,
  );
}

export function listCampaignsUsingInGroup(
  inGroupId: string,
): CampaignRecord[] {
  return db()
    .prepare(
      `SELECT c.* FROM campaigns c
         JOIN campaign_in_groups cig ON cig.campaign_id = c.id
        WHERE cig.in_group_id = ?
        ORDER BY c.created_at DESC`,
    )
    .all(inGroupId) as unknown as CampaignRecord[];
}

/**
 * In-groups attached to any campaign that this agent is a member of.
 * The agent console uses this to render "your in-groups" — across every
 * campaign the user is bound to, deduped.
 */
export function getInGroupsForAgent(
  userId: string,
): Array<{ in_group_id: string; in_group_name: string; campaign_id: string; campaign_name: string }> {
  return db()
    .prepare(
      `SELECT DISTINCT ig.id AS in_group_id, ig.name AS in_group_name,
              c.id AS campaign_id, c.name AS campaign_name
         FROM user_campaigns uc
         JOIN campaigns c ON c.id = uc.campaign_id
         JOIN campaign_in_groups cig ON cig.campaign_id = c.id
         JOIN in_groups ig ON ig.id = cig.in_group_id
        WHERE uc.user_id = ?
        ORDER BY c.name ASC, ig.name ASC`,
    )
    .all(userId) as unknown as Array<{
    in_group_id: string;
    in_group_name: string;
    campaign_id: string;
    campaign_name: string;
  }>;
}

export function setCampaignInGroups(
  campaignId: string,
  inGroupIds: string[],
): void {
  const d = db();
  d.exec('BEGIN');
  try {
    d.prepare(`DELETE FROM campaign_in_groups WHERE campaign_id = ?`).run(
      campaignId,
    );
    if (inGroupIds.length > 0) {
      const stmt = d.prepare(
        `INSERT INTO campaign_in_groups (campaign_id, in_group_id) VALUES (?, ?)`,
      );
      for (const gid of inGroupIds) stmt.run(campaignId, gid);
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
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
    dial_mode: string;
    hopper_level: number;
    dial_level: number;
    amd_action: string;
    voicemail_path: string | null;
    list_order: string;
    dialable_statuses: string;
    voicemail_config: string | null;
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
    /** Iter 74 — kept in sync with the lowest-priority row in
     * route_plan_carriers so legacy readers stay correct. */
    primary_carrier_id: string;
    failover_carrier_ids_json: string;
    cid_strategy: string;
    cid_single: string | null;
    cid_pool_json: string;
    cid_group_ids_json: string;
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

/**
 * Iter 23 — reads lead_lists.campaign_id directly. The old
 * campaign_lead_lists join table is no longer authoritative; queries
 * that need the list of attached lists go through this helper.
 */
export function getCampaignLeadListIds(campaignId: string): string[] {
  const rows = db()
    .prepare(
      `SELECT id FROM lead_lists WHERE campaign_id = ? ORDER BY created_at ASC`,
    )
    .all(campaignId) as Array<{ id: string }>;
  return rows.map((r) => r.id);
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

/**
 * Iter 23 — at most one campaign owns a list (lead_lists.campaign_id).
 * Returns an array for API back-compat, but in practice has 0 or 1 entry.
 */
export function listCampaignsUsingLeadList(
  leadListId: string,
): CampaignRecord[] {
  return db()
    .prepare(
      `SELECT c.* FROM campaigns c
       JOIN lead_lists ll ON ll.campaign_id = c.id
       WHERE ll.id = ?`,
    )
    .all(leadListId) as unknown as CampaignRecord[];
}

// Returns route plans where the given carrier appears as primary OR failover.
export function listRoutePlansUsingCarrier(
  carrierId: string,
): RoutePlanRecord[] {
  // Iter 74 — switched from a LIKE on the legacy
  // failover_carrier_ids_json column to a join against
  // route_plan_carriers, which is now the source of truth. Still
  // returns each plan only once even when the same carrier appears
  // at multiple priorities (which the UNIQUE constraint prevents,
  // but DISTINCT here is defence-in-depth).
  return db()
    .prepare(
      `SELECT DISTINCT rp.*
         FROM route_plans rp
         JOIN route_plan_carriers rpc ON rpc.route_plan_id = rp.id
        WHERE rpc.carrier_id = ?
        ORDER BY rp.created_at DESC`,
    )
    .all(carrierId) as unknown as RoutePlanRecord[];
}

/** Iter 75 — for each carrier in the input list, return the count of
 * route plans that currently attach it (via the route_plan_carriers
 * join). Used on the carriers list page to show "used by N plans"
 * per row. Returns a Map keyed by carrier_id. */
export function countRoutePlansPerCarrier(
  carrierIds: string[],
): Map<string, number> {
  if (carrierIds.length === 0) return new Map();
  const placeholders = carrierIds.map(() => '?').join(',');
  const rows = db()
    .prepare(
      `SELECT carrier_id, COUNT(DISTINCT route_plan_id) AS n
         FROM route_plan_carriers
        WHERE carrier_id IN (${placeholders})
        GROUP BY carrier_id`,
    )
    .all(...carrierIds) as Array<{ carrier_id: string; n: number }>;
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.carrier_id, Number(r.n));
  return out;
}

// =====================================================================
// lead_hopper (iter 49)
// =====================================================================
//
// ViciDial-style pre-load queue. The pacer pops from here on each
// originate; a separate refill step keeps the depth at hopper_level.
// Insert order is preserved by the auto-increment id, so callback-due
// leads (queued first in each refill) come out before fresh
// NEW/CALLED_NO_ANSWER leads queued in the same refill.

export function hopperSize(campaignId: string): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM lead_hopper WHERE campaign_id = ?`)
    .get(campaignId) as { n: number };
  return row.n;
}

/**
 * Iter 49 — refill the hopper up to `target`. Inserts are
 * INSERT-OR-IGNORE against the UNIQUE(campaign_id, lead_id) constraint
 * so re-running this is harmless. Returns the number of leads added.
 *
 * Pass 1 inserts callback-due leads (priority by callback_at).
 * Pass 2 inserts dialable NEW / CALLED_NO_ANSWER / BUSY leads
 * (priority by last_called_at, NULLs first). Cooldown matches
 * pickNextDialableLead so the hopper never pre-loads a lead the
 * cooldown would skip.
 */
/** Iter 70 — drop every queued lead for a campaign. The pacer's
 * next tick will rebuild the hopper from scratch using whatever
 * list_order the campaign is set to. */
export function clearHopper(campaignId: string): number {
  const result = db()
    .prepare(`DELETE FROM lead_hopper WHERE campaign_id = ?`)
    .run(campaignId);
  return Number(result.changes);
}

export function refillHopper(
  campaignId: string,
  target: number,
  cooldownSeconds: number,
  /** Iter 91 — optional list of currently-dialable timezone IDs
   * (from the campaign's call window). When the list_order
   * strategy is TZ_* and this is non-empty, the refill query adds
   * `AND l.timezone IN (...)` so only leads whose local hour is
   * inside the window get fed into the hopper. Caller (pacer)
   * computes the list in JS per tick from the campaign's
   * call_window_start/end + every distinct lead timezone. */
  dialableTimezones?: string[],
): number {
  const d = db();
  const current = hopperSize(campaignId);
  const slots = Math.max(0, target - current);
  if (slots === 0) return 0;

  const now = new Date().toISOString();
  const cooldownCutoff = new Date(
    Date.now() - cooldownSeconds * 1000,
  ).toISOString();

  let added = 0;

  // Pass 1: callback-due — timezone gate doesn't apply; honoring a
  // scheduled callback time outweighs the window heuristic.
  const cbResult = d
    .prepare(
      `INSERT OR IGNORE INTO lead_hopper (campaign_id, lead_id)
       SELECT ?, l.id
         FROM leads l
         JOIN lead_lists ll ON ll.id = l.list_id
        WHERE ll.campaign_id = ?
          AND l.status = 'CALLBACK_SCHEDULED'
          AND l.callback_at IS NOT NULL
          AND l.callback_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM lead_hopper h
             WHERE h.campaign_id = ? AND h.lead_id = l.id
          )
        ORDER BY l.callback_at ASC, l.created_at ASC
        LIMIT ?`,
    )
    .run(campaignId, campaignId, now, campaignId, slots);
  added += Number(cbResult.changes);

  const remaining = slots - added;
  if (remaining <= 0) return added;

  // Pass 2: leads whose status is in the campaign's
  // dialable_statuses whitelist (iter 94). Default keeps the old
  // hardcoded set; operator can tighten/loosen per campaign.
  // Untouched leads (last_called_at IS NULL) always come before
  // previously-tried ones in any strategy.
  const campaign = getCampaignFromDb(campaignId);
  const strategy = campaign?.list_order ?? 'RANDOM';
  // Parse dialable_statuses JSON. Defensive against malformed data:
  // fall back to the historical hardcoded set so a bad config never
  // turns the campaign off silently.
  let allowedStatuses: string[] = ['NEW', 'CALLED_NO_ANSWER', 'BUSY'];
  if (campaign?.dialable_statuses) {
    try {
      const parsed = JSON.parse(campaign.dialable_statuses);
      if (Array.isArray(parsed) && parsed.length > 0) {
        allowedStatuses = parsed.filter(
          (s): s is string => typeof s === 'string',
        );
      }
    } catch {
      /* keep fallback */
    }
  }
  // Iter 91 — TZ-aware strategies layer a "lead's TZ is currently
  // in the dialable window" filter on top of the order. Order
  // semantics mirror the non-TZ variants: random / oldest /
  // newest within the eligible-now subset.
  const isTzStrategy =
    strategy === 'TZ_RANDOM' ||
    strategy === 'TZ_UP_TIME' ||
    strategy === 'TZ_DOWN_TIME';
  const orderClause =
    strategy === 'UP_TIME' || strategy === 'TZ_UP_TIME'
      ? `ORDER BY (l.last_called_at IS NULL) DESC, l.created_at ASC`
      : strategy === 'DOWN_TIME' || strategy === 'TZ_DOWN_TIME'
        ? `ORDER BY (l.last_called_at IS NULL) DESC, l.created_at DESC`
        : `ORDER BY (l.last_called_at IS NULL) DESC, RANDOM()`;

  let tzClause = '';
  const tzValues: string[] = [];
  if (isTzStrategy && dialableTimezones && dialableTimezones.length > 0) {
    const placeholders = dialableTimezones.map(() => '?').join(',');
    tzClause = `AND l.timezone IN (${placeholders})`;
    tzValues.push(...dialableTimezones);
  } else if (isTzStrategy) {
    // TZ strategy chosen but no dialable TZs right now — feed
    // nothing; the campaign is effectively idle until a TZ opens.
    return added;
  }

  const statusPlaceholders = allowedStatuses.map(() => '?').join(',');
  const dResult = d
    .prepare(
      `INSERT OR IGNORE INTO lead_hopper (campaign_id, lead_id)
       SELECT ?, l.id
         FROM leads l
         JOIN lead_lists ll ON ll.id = l.list_id
        WHERE ll.campaign_id = ?
          AND l.status IN (${statusPlaceholders})
          AND (l.last_called_at IS NULL OR l.last_called_at < ?)
          ${tzClause}
          AND NOT EXISTS (
            SELECT 1 FROM lead_hopper h
             WHERE h.campaign_id = ? AND h.lead_id = l.id
          )
        ${orderClause}
        LIMIT ?`,
    )
    .run(
      campaignId,
      campaignId,
      ...(allowedStatuses as never[]),
      cooldownCutoff,
      ...(tzValues as never[]),
      campaignId,
      remaining,
    );
  added += Number(dResult.changes);

  return added;
}

/** Iter 94 — parse the campaign's dialable_statuses JSON into a
 * string[]. Returns the historical default when malformed/empty
 * so callers always have a usable list. */
export function parseDialableStatuses(c: CampaignRecord): string[] {
  if (!c.dialable_statuses) return ['NEW', 'CALLED_NO_ANSWER', 'BUSY'];
  try {
    const parsed = JSON.parse(c.dialable_statuses);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter((s): s is string => typeof s === 'string');
    }
  } catch {
    /* fall through */
  }
  return ['NEW', 'CALLED_NO_ANSWER', 'BUSY'];
}

/** Iter 94 — bulk reset selected leads back to NEW (and clear
 * last_called_at so the cooldown gate doesn't keep them out).
 * Scope is always a list + a status filter (e.g. "reset every
 * CALLED_NO_ANSWER in list X back to NEW") so operators can't
 * accidentally nuke leads outside the list they're looking at.
 * Returns the number of rows actually changed. */
export function bulkResetLeadsInList(
  listId: string,
  fromStatus: string,
): number {
  const result = db()
    .prepare(
      `UPDATE leads
          SET status = 'NEW',
              last_called_at = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE list_id = ?
          AND status = ?`,
    )
    .run(listId, fromStatus);
  return Number(result.changes);
}

/** Iter 91 — distinct non-null timezones across all leads of a
 * campaign's attached lists. Caller can use this list to bound the
 * "which TZs are dialable right now?" check in JS. */
export function listLeadTimezonesForCampaign(campaignId: string): string[] {
  const rows = db()
    .prepare(
      `SELECT DISTINCT l.timezone AS tz
         FROM leads l
         JOIN lead_lists ll ON ll.id = l.list_id
        WHERE ll.campaign_id = ?
          AND l.timezone IS NOT NULL`,
    )
    .all(campaignId) as Array<{ tz: string }>;
  return rows.map((r) => r.tz);
}

/**
 * Iter 49 — atomic pop. Returns the next lead in the hopper for this
 * campaign and removes its row in the same statement. Returns
 * `undefined` when the hopper is empty so the caller can decide
 * whether to refill + retry.
 */
export function popHopperLead(
  campaignId: string,
):
  | {
      lead_id: string;
      list_id: string;
      phone: string;
      name: string | null;
      preferred_cid: string | null;
    }
  | undefined {
  const d = db();
  const row = d
    .prepare(
      `DELETE FROM lead_hopper
        WHERE id = (
          SELECT id FROM lead_hopper
           WHERE campaign_id = ?
           ORDER BY id ASC
           LIMIT 1
        )
       RETURNING lead_id`,
    )
    .get(campaignId) as { lead_id: string } | undefined;
  if (!row) return undefined;

  // Iter 125 — surface preferred_cid alongside the rest of the
  // picked-lead fields. NULL = use route plan strategy.
  const lead = d
    .prepare(
      `SELECT id AS lead_id, list_id, phone, name, preferred_cid
         FROM leads WHERE id = ?`,
    )
    .get(row.lead_id) as
    | {
        lead_id: string;
        list_id: string;
        phone: string;
        name: string | null;
        preferred_cid: string | null;
      }
    | undefined;
  return lead;
}

// =====================================================================
// phones (iter 40)
// =====================================================================

export interface PhoneRecord {
  id: string;
  user_id: string;
  extension: string;
  label: string | null;
  protocol: string;
  password: string;
  is_primary: number;
  telephony_node_id: string | null;
  created_at: string;
  updated_at: string;
}

export function insertPhone(rec: {
  id: string;
  user_id: string;
  extension: string;
  label?: string | null;
  protocol?: string;
  password: string;
  is_primary?: boolean;
  telephony_node_id?: string | null;
}): void {
  db()
    .prepare(
      `INSERT INTO phones (id, user_id, extension, label, protocol, password, is_primary, telephony_node_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.id,
      rec.user_id,
      rec.extension,
      rec.label ?? null,
      rec.protocol ?? 'sip',
      rec.password,
      rec.is_primary ? 1 : 0,
      rec.telephony_node_id ?? null,
    );
}

export function listPhonesForUser(userId: string): PhoneRecord[] {
  return db()
    .prepare(
      `SELECT * FROM phones WHERE user_id = ? ORDER BY is_primary DESC, extension ASC`,
    )
    .all(userId) as unknown as PhoneRecord[];
}

export function getPhoneById(id: string): PhoneRecord | undefined {
  return db()
    .prepare(`SELECT * FROM phones WHERE id = ?`)
    .get(id) as unknown as PhoneRecord | undefined;
}

export function getPhoneByExtension(
  extension: string,
): PhoneRecord | undefined {
  return db()
    .prepare(`SELECT * FROM phones WHERE extension = ?`)
    .get(extension) as unknown as PhoneRecord | undefined;
}

export function getPrimaryPhoneForUser(
  userId: string,
): PhoneRecord | undefined {
  return db()
    .prepare(
      `SELECT * FROM phones WHERE user_id = ? AND is_primary = 1 LIMIT 1`,
    )
    .get(userId) as unknown as PhoneRecord | undefined;
}

export function updatePhoneFields(
  id: string,
  updates: Partial<{
    extension: string;
    label: string | null;
    protocol: string;
    password: string;
    is_primary: boolean;
    telephony_node_id: string | null;
  }>,
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    if (key === 'is_primary') values.push(value ? 1 : 0);
    else values.push(value as string | null);
  }
  if (fields.length === 0) return false;
  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);
  const result = db()
    .prepare(`UPDATE phones SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]));
  return Number(result.changes) > 0;
}

/** Clears is_primary on all of a user's phones except `keepId`. */
export function unsetOtherPrimaryPhones(userId: string, keepId: string): void {
  db()
    .prepare(
      `UPDATE phones SET is_primary = 0, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND id != ? AND is_primary = 1`,
    )
    .run(userId, keepId);
}

export function deletePhone(id: string): boolean {
  const result = db().prepare(`DELETE FROM phones WHERE id = ?`).run(id);
  return Number(result.changes) > 0;
}

// =====================================================================
// agent_status (iter 40)
// =====================================================================

export interface AgentStatusRecord {
  user_id: string;
  status: string;
  reason: string | null;
  updated_at: string;
}

export function getAgentStatus(userId: string): AgentStatusRecord {
  const row = db()
    .prepare(`SELECT * FROM agent_status WHERE user_id = ?`)
    .get(userId) as AgentStatusRecord | undefined;
  return (
    row ?? {
      user_id: userId,
      status: 'AVAILABLE',
      reason: null,
      updated_at: new Date().toISOString(),
    }
  );
}

export function setAgentStatus(
  userId: string,
  status: 'AVAILABLE' | 'PAUSED',
  reason: string | null,
): void {
  db()
    .prepare(
      `INSERT INTO agent_status (user_id, status, reason, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         status = excluded.status,
         reason = excluded.reason,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .run(userId, status, reason);
}

/**
 * Iter 40 — overload of getActiveAgentsForCampaign that filters out
 * agents currently in PAUSED status. The pacer uses this so paused
 * agents don't pull live calls.
 */
export function getAvailableAgentsForCampaign(
  campaignId: string,
): Array<{ id: string; username: string }> {
  const rows = getActiveAgentsForCampaign(campaignId);
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const paused = db()
    .prepare(
      `SELECT user_id FROM agent_status
       WHERE status = 'PAUSED' AND user_id IN (${placeholders})`,
    )
    .all(...ids) as Array<{ user_id: string }>;
  if (paused.length === 0) return rows;
  const pausedSet = new Set(paused.map((p) => p.user_id));
  return rows.filter((r) => !pausedSet.has(r.id));
}

// =====================================================================
// dnc_phones (iter 64) — Do Not Call list
// =====================================================================
//
// Numbers we are never allowed to dial regardless of campaign / list.
// Pacer + manual dial + test-call all check `isDncPhone` against the
// normalized phone before originate. Compliance-driven, append-only
// in practice (the UI can remove rows but there's no soft-delete).

export interface DncPhoneRecord {
  phone: string;
  reason: string | null;
  added_by_user_id: string | null;
  added_at: string;
}

export function insertDncPhone(rec: {
  phone: string;
  reason?: string | null;
  added_by_user_id?: string | null;
}): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO dnc_phones (phone, reason, added_by_user_id)
       VALUES (?, ?, ?)`,
    )
    .run(rec.phone, rec.reason ?? null, rec.added_by_user_id ?? null);
}

export function deleteDncPhone(phone: string): boolean {
  const result = db()
    .prepare(`DELETE FROM dnc_phones WHERE phone = ?`)
    .run(phone);
  return Number(result.changes) > 0;
}

export function isDncPhone(phone: string): boolean {
  const row = db()
    .prepare(`SELECT 1 FROM dnc_phones WHERE phone = ?`)
    .get(phone);
  return !!row;
}

/** Iter 106 — full-record lookup for the manager's "Check DNC
 * status" card. Returns the row when present so the operator
 * sees not just yes/no but reason + when + who added it. */
export function getDncPhoneRecord(phone: string): DncPhoneRecord | undefined {
  return db()
    .prepare(`SELECT * FROM dnc_phones WHERE phone = ?`)
    .get(phone) as DncPhoneRecord | undefined;
}

export function listDncPhonesFromDb(
  limit = 500,
  offset = 0,
): DncPhoneRecord[] {
  return db()
    .prepare(
      `SELECT * FROM dnc_phones ORDER BY added_at DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as unknown as DncPhoneRecord[];
}

export function countDncPhones(): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM dnc_phones`)
    .get() as { n: number };
  return row.n;
}

// =====================================================================
// remote_agents (iter 57)
// =====================================================================
//
// External SIP endpoints — typically hard phones at remote offices —
// that the pacer can bridge calls to instead of (or alongside)
// browser-based local agents. Each has a `lines` capacity; iter 58
// folds that into the pacing formula
// `(local_agents + Σ remote_agent_lines) × dial_level`.

export interface RemoteAgentRecord {
  id: string;
  name: string;
  sip_uri: string;
  telephony_node_id: string | null;
  extension: string | null;
  campaign_id: string | null;
  lines: number;
  enabled: number;
  /** Iter 90 — auto-provisioned user that backs this remote agent.
   * The user has a primary Phone matching the remote agent's
   * extension, and can register from a hard phone / softphone. */
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export function insertRemoteAgent(rec: {
  id: string;
  name: string;
  sip_uri: string;
  telephony_node_id: string | null;
  extension: string | null;
  campaign_id: string | null;
  lines: number;
  enabled: boolean;
}): void {
  db()
    .prepare(
      `INSERT INTO remote_agents
         (id, name, sip_uri, telephony_node_id, extension, campaign_id, lines, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.id,
      rec.name,
      rec.sip_uri,
      rec.telephony_node_id,
      rec.extension,
      rec.campaign_id,
      rec.lines,
      rec.enabled ? 1 : 0,
    );
}

export function listRemoteAgentsFromDb(): RemoteAgentRecord[] {
  return db()
    .prepare(`SELECT * FROM remote_agents ORDER BY name ASC`)
    .all() as unknown as RemoteAgentRecord[];
}

export function getRemoteAgentFromDb(id: string): RemoteAgentRecord | undefined {
  return db()
    .prepare(`SELECT * FROM remote_agents WHERE id = ?`)
    .get(id) as unknown as RemoteAgentRecord | undefined;
}

export function updateRemoteAgentFields(
  id: string,
  updates: Partial<{
    name: string;
    sip_uri: string;
    telephony_node_id: string | null;
    extension: string | null;
    campaign_id: string | null;
    lines: number;
    enabled: boolean;
    /** Iter 90 — link to the auto-provisioned User backing this
     * remote agent. */
    user_id: string | null;
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
    .prepare(`UPDATE remote_agents SET ${fields.join(', ')} WHERE id = ?`)
    .run(...(values as never[]));
  return Number(result.changes) > 0;
}

export function deleteRemoteAgentFromDb(id: string): boolean {
  const result = db()
    .prepare(`DELETE FROM remote_agents WHERE id = ?`)
    .run(id);
  return Number(result.changes) > 0;
}
