import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
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

    -- Iter 28: cross-cutting key/value store for admin-managed settings
    -- (SignalWire token, future telephony bootstrap state, etc.). Values
    -- are envelope-encrypted at rest via the secrets module — stored as
    -- the string envelope "v1:iv:tag:ciphertext".
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_encrypted TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Iter 21: campaign ↔ in-group attachment. Inbound and blended
    -- campaigns route calls from their attached in-groups to agents
    -- logged into the campaign.
    CREATE TABLE IF NOT EXISTS campaign_in_groups (
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      in_group_id TEXT NOT NULL REFERENCES in_groups(id) ON DELETE CASCADE,
      PRIMARY KEY (campaign_id, in_group_id)
    );

    CREATE INDEX IF NOT EXISTS idx_cig_in_group
      ON campaign_in_groups(in_group_id);

    CREATE TABLE IF NOT EXISTS lead_hopper (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      queued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(campaign_id, lead_id)
    );

    CREATE TABLE IF NOT EXISTS remote_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sip_uri TEXT NOT NULL,
      telephony_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
      lines INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_remote_agents_enabled
      ON remote_agents(enabled);

    CREATE INDEX IF NOT EXISTS idx_lead_hopper_campaign
      ON lead_hopper(campaign_id, id);

    CREATE TABLE IF NOT EXISTS phones (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      extension TEXT NOT NULL,
      label TEXT,
      protocol TEXT NOT NULL DEFAULT 'sip',
      password TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(extension)
    );

    CREATE INDEX IF NOT EXISTS idx_phones_user ON phones(user_id);

    CREATE TABLE IF NOT EXISTS agent_status (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      reason TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dnc_phones (
      phone TEXT PRIMARY KEY,
      reason TEXT,
      added_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Iter 72: CID groups — reusable pool of caller-IDs with their own
    -- rotation logic. Route plans attach one or more groups; pacer
    -- round-robins across groups per call, then applies the group's
    -- per-call strategy (rotate / random / sticky_by_area).
    CREATE TABLE IF NOT EXISTS cid_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      strategy TEXT NOT NULL DEFAULT 'rotate',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cid_group_numbers (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES cid_groups(id) ON DELETE CASCADE,
      number TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, number)
    );
    CREATE INDEX IF NOT EXISTS idx_cid_group_numbers_group ON cid_group_numbers(group_id);

    -- Iter 74: route plan ↔ carriers join table with priority + port
    -- allocation. Replaces the legacy primary_carrier_id +
    -- failover_carrier_ids_json model. Same priority across multiple
    -- carriers means round-robin within that tier (so two carriers at
    -- priority 1 = 50/50 split). ports is the per-(plan,carrier)
    -- concurrent-call cap enforced at originate time. Legacy columns
    -- stay populated for back-compat.
    CREATE TABLE IF NOT EXISTS route_plan_carriers (
      id TEXT PRIMARY KEY,
      route_plan_id TEXT NOT NULL REFERENCES route_plans(id) ON DELETE CASCADE,
      carrier_id TEXT NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
      priority INTEGER NOT NULL DEFAULT 1,
      ports INTEGER NOT NULL DEFAULT 30,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(route_plan_id, carrier_id)
    );
    CREATE INDEX IF NOT EXISTS idx_route_plan_carriers_plan
      ON route_plan_carriers(route_plan_id, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_route_plan_carriers_carrier
      ON route_plan_carriers(carrier_id);
  `);

  // Idempotent ALTERs — sqlite has no IF NOT EXISTS for columns. We
  // try each one; "duplicate column name" errors mean it's already
  // applied (harmless). Any other error gets propagated.
  const migrations: string[] = [
    "ALTER TABLE users ADD COLUMN display_name TEXT",
    "ALTER TABLE users ADD COLUMN skill_tier TEXT NOT NULL DEFAULT 'new'",
    "ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
    // iter 16: pacing v2 attributes each dial intent to an agent.
    // Nullable: existing rows + future "no agent" intents stay NULL.
    "ALTER TABLE dial_intents ADD COLUMN assigned_user_id TEXT",
    // iter 18: agent dispositions. NULL = not yet dispositioned.
    "ALTER TABLE dial_intents ADD COLUMN disposition TEXT",
    "ALTER TABLE dial_intents ADD COLUMN dispositioned_at TEXT",
    "ALTER TABLE dial_intents ADD COLUMN callback_at TEXT",
    // iter 19: schedule-aware picker. Mirrors callback_at onto the lead so
    // pickNextDialableLead can compare without joining to dial_intents.
    "ALTER TABLE leads ADD COLUMN callback_at TEXT",
    // iter 23: a lead list now belongs to AT MOST ONE campaign. The join
    // table campaign_lead_lists stays around (silently ignored) so old
    // installations migrate cleanly; the new column is the source of truth.
    "ALTER TABLE lead_lists ADD COLUMN campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL",
    // Iter 32: per-campaign dial mode. 'simulated' (default, safe) inserts
    // dial-intent rows only. 'live' issues a real bgapi originate via the
    // route plan's primary carrier gateway. Default is intentionally safe
    // so existing campaigns keep their no-cost behavior until an admin
    // opts in.
    "ALTER TABLE campaigns ADD COLUMN dial_mode TEXT NOT NULL DEFAULT 'simulated'",
    // Iter 32: track the FreeSWITCH-side outcome of each live tick.
    // call_uuid is the channel/job UUID returned by bgapi originate;
    // originate_error captures the FS error string when the originate
    // failed. Both NULL on simulated rows.
    "ALTER TABLE dial_intents ADD COLUMN call_uuid TEXT",
    "ALTER TABLE dial_intents ADD COLUMN originate_error TEXT",
    // Iter 33: hangup correlation. We generate a UUID and set it as a
    // channel variable on originate (dialeros_correlation_id=<uuid>).
    // The FS event listener picks the variable out of CHANNEL_ANSWER /
    // CHANNEL_HANGUP_COMPLETE events and writes the call's outcome
    // back onto the matching dial_intent. Job UUIDs aren't reliable
    // across event types, but a custom variable always survives.
    "ALTER TABLE dial_intents ADD COLUMN correlation_id TEXT",
    "ALTER TABLE dial_intents ADD COLUMN hangup_cause TEXT",
    "ALTER TABLE dial_intents ADD COLUMN answered_at TEXT",
    "ALTER TABLE dial_intents ADD COLUMN hangup_at TEXT",
    "ALTER TABLE dial_intents ADD COLUMN duration_ms INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_dial_intents_correlation ON dial_intents(correlation_id)",
    // Iter 40: per-user manual-dial capability. When true, the user's
    // softphone exposes a CLI/dialer input for placing arbitrary
    // outbound calls. Default false — most agents only auto-answer
    // pacer-bridged calls.
    "ALTER TABLE users ADD COLUMN manual_dial INTEGER NOT NULL DEFAULT 0",
    // Iter 43: fine-grained ACL. JSON array of permission slugs the
    // user has been granted. NULL → fall back to the role's defaults
    // (defaultPermissionsForRole in user-mgmt). Admins implicitly
    // have every permission regardless of this column.
    "ALTER TABLE users ADD COLUMN permissions TEXT",
    // Iter 44: carrier-level dial-plan prefix list. JSON array of
    // destination prefixes this carrier accepts (e.g. ["310","311",
    // "312"]). NULL or empty array means the carrier accepts every
    // destination (existing behavior, backward compatible).
    "ALTER TABLE carriers ADD COLUMN dial_prefixes TEXT",
    // Iter 45: ViciDial-style carrier dial-plan rewrite rules. JSON
    // array of { match_prefix, replacements[] } objects. When the
    // destination starts with match_prefix the rule strips it and
    // rotates through `replacements` to prepend a different one each
    // call (e.g. spread 0805XXXX traffic across 310/311/312/...).
    // NULL or empty array means no rewrite — destination dialed as-is.
    "ALTER TABLE carriers ADD COLUMN dial_plan_rules TEXT",
    // Iter 49: per-campaign hopper + dial level. hopper_level is the
    // target queue depth (number of leads to keep pre-loaded);
    // dial_level scales how many calls the pacer originates per tick
    // relative to the active-agent count (1.0 = 1:1 power dial,
    // 1.5 = predictive 1.5x, etc.).
    "ALTER TABLE campaigns ADD COLUMN hopper_level INTEGER NOT NULL DEFAULT 100",
    "ALTER TABLE campaigns ADD COLUMN dial_level REAL NOT NULL DEFAULT 1.0",
    // Iter 55: call recording. Absolute path on the FS box (relative
    // to the configured recordings dir if you want to host on
    // remote storage later). NULL means this intent wasn't recorded.
    "ALTER TABLE dial_intents ADD COLUMN recording_path TEXT",
    // Iter 66: per-campaign AMD / voicemail-drop behaviour.
    //   bridge    — default; original behavior, always bridge to agent.
    //   drop      — hang up at answer (probing / opt-out flows).
    //   voicemail — play the campaigns uploaded voicemail file and
    //               hang up. Voice-blast mode. The path is the absolute
    //               wav on the FS box (set by the campaign-detail
    //               upload form).
    "ALTER TABLE campaigns ADD COLUMN amd_action TEXT NOT NULL DEFAULT 'bridge'",
    "ALTER TABLE campaigns ADD COLUMN voicemail_path TEXT",
    // Iter 70: ViciDial-style list-order strategy. Drives how the
    // hopper refill picks dialable leads:
    //   RANDOM    — ORDER BY RANDOM() (default).
    //   UP_TIME   — oldest created_at first (clear legacy backlog).
    //   DOWN_TIME — newest created_at first (work fresh imports).
    // Callback-due leads are always priority-1 regardless of strategy.
    "ALTER TABLE campaigns ADD COLUMN list_order TEXT NOT NULL DEFAULT 'RANDOM'",
    // Iter 58: remote-agent bridging. When the pacer bridges to a
    // remote agent (SIP URI) instead of a local user/<ext>, this
    // column holds the remote_agents.id so we can roll up in-flight
    // calls per remote agent for capacity checks. NULL when the
    // bridge target was a local agent.
    "ALTER TABLE dial_intents ADD COLUMN remote_agent_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_dial_intents_remote_agent ON dial_intents(remote_agent_id, hangup_at)",
    // Iter 59: per-campaign scoping for remote agents + structured
    // extension storage so the create form can be a node-dropdown +
    // extension input instead of raw sip:user@host. NULL campaign
    // = available to every campaign (shared pool, existing behavior).
    // extension is nullable for back-compat with iter-57 agents whose
    // raw sip_uri was hand-entered.
    "ALTER TABLE remote_agents ADD COLUMN campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL",
    "ALTER TABLE remote_agents ADD COLUMN extension TEXT",
    "CREATE INDEX IF NOT EXISTS idx_remote_agents_campaign ON remote_agents(campaign_id)",
    // Iter 61: nodes wear multiple roles. Legacy single-role column
    // stays around; `roles` is JSON-encoded NodeRole[] and is the
    // new source of truth. `is_self` flags the auto-registered
    // local-host row so destructive ops are blocked on it.
    "ALTER TABLE nodes ADD COLUMN roles TEXT",
    "ALTER TABLE nodes ADD COLUMN is_self INTEGER NOT NULL DEFAULT 0",
    // Iter 62: pin each phone to the telephony node that hosts it.
    // softphone-config returns the bound node's host so the
    // browser registers to the correct FS instance even in a
    // multi-node cluster. NULL = auto-pick the only available
    // telephony node (single-box deploys never have to touch
    // this column).
    "ALTER TABLE phones ADD COLUMN telephony_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL",
    "CREATE INDEX IF NOT EXISTS idx_phones_telephony_node ON phones(telephony_node_id)",
    // Iter 72: route plans can attach 0..N CID groups. When
    // cid_strategy='groups', the pacer rotates across these groups
    // per call and applies each group's own strategy. Default '[]'
    // keeps every existing plan a no-op.
    "ALTER TABLE route_plans ADD COLUMN cid_group_ids_json TEXT NOT NULL DEFAULT '[]'",
    // Iter 74: per-call carrier attribution. Pacer writes the carrier
    // actually picked for each originate so we can count in-flight per
    // carrier for the port-cap gate, plus break down reports by
    // carrier. NULL on old rows + simulated calls.
    "ALTER TABLE dial_intents ADD COLUMN carrier_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_dial_intents_carrier ON dial_intents(carrier_id, hangup_at)",
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
export function reapStaleDialIntents(maxAgeSeconds = 300): number {
  const result = db()
    .prepare(
      `UPDATE dial_intents
          SET hangup_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
              originate_error = COALESCE(
                originate_error,
                ?
              )
        WHERE hangup_at IS NULL
          AND kind = 'live'
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
  user_username: string | null;
}
export function listActiveCalls(): ActiveCallRecord[] {
  return db()
    .prepare(
      `SELECT i.*, c.name AS campaign_name, u.username AS user_username
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
         SET disposition = ?, dispositioned_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
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

  // Pass 1: callback-due
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

  // Pass 2: NEW / CALLED_NO_ANSWER / BUSY — order depends on the
  // campaign's list_order strategy (iter 70). Untouched leads
  // (last_called_at IS NULL) always come before previously-tried
  // ones in any strategy; that's the typical ViciDial behaviour
  // and matches "work the new stuff first".
  const campaign = getCampaignFromDb(campaignId);
  const strategy = campaign?.list_order ?? 'RANDOM';
  const orderClause =
    strategy === 'UP_TIME'
      ? `ORDER BY (l.last_called_at IS NULL) DESC, l.created_at ASC`
      : strategy === 'DOWN_TIME'
        ? `ORDER BY (l.last_called_at IS NULL) DESC, l.created_at DESC`
        : `ORDER BY (l.last_called_at IS NULL) DESC, RANDOM()`;

  const dResult = d
    .prepare(
      `INSERT OR IGNORE INTO lead_hopper (campaign_id, lead_id)
       SELECT ?, l.id
         FROM leads l
         JOIN lead_lists ll ON ll.id = l.list_id
        WHERE ll.campaign_id = ?
          AND l.status IN ('NEW', 'CALLED_NO_ANSWER', 'BUSY')
          AND (l.last_called_at IS NULL OR l.last_called_at < ?)
          AND NOT EXISTS (
            SELECT 1 FROM lead_hopper h
             WHERE h.campaign_id = ? AND h.lead_id = l.id
          )
        ${orderClause}
        LIMIT ?`,
    )
    .run(campaignId, campaignId, cooldownCutoff, campaignId, remaining);
  added += Number(dResult.changes);

  return added;
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
  | { lead_id: string; list_id: string; phone: string; name: string | null }
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

  const lead = d
    .prepare(
      `SELECT id AS lead_id, list_id, phone, name FROM leads WHERE id = ?`,
    )
    .get(row.lead_id) as
    | { lead_id: string; list_id: string; phone: string; name: string | null }
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
