// Iter 111 — schema + migrations split out of db.ts. db.ts grew
// past 4800 lines as iters 8-108 added columns + tables; pulling
// the CREATE TABLE block and the idempotent ALTER list to their
// own module trims db.ts by ~500 lines and clarifies the boundary
// between "schema declarations" (this file) and "query helpers"
// (db.ts). No behavior change — db.ts still drives the d.exec()
// calls; this is just where the SQL strings live.

export const CREATE_TABLES_SQL = `
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
`;

// Idempotent ALTERs — sqlite has no IF NOT EXISTS for columns. The
// caller try/catches each one; "duplicate column name" errors mean
// it's already applied (harmless), other errors propagate.
export const COLUMN_MIGRATIONS: string[] = [
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
  // iter 19: schedule-aware picker. Mirrors callback_at onto the lead
  // so pickNextDialableLead can compare without joining to dial_intents.
  "ALTER TABLE leads ADD COLUMN callback_at TEXT",
  // iter 23: a lead list now belongs to AT MOST ONE campaign.
  "ALTER TABLE lead_lists ADD COLUMN campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL",
  // Iter 32: per-campaign dial mode. 'simulated' or 'live'.
  "ALTER TABLE campaigns ADD COLUMN dial_mode TEXT NOT NULL DEFAULT 'simulated'",
  // Iter 32: FS-side outcome columns.
  "ALTER TABLE dial_intents ADD COLUMN call_uuid TEXT",
  "ALTER TABLE dial_intents ADD COLUMN originate_error TEXT",
  // Iter 33: hangup correlation. Channel var that survives every FS
  // event type so the listener can match back to a dial_intent row.
  "ALTER TABLE dial_intents ADD COLUMN correlation_id TEXT",
  "ALTER TABLE dial_intents ADD COLUMN hangup_cause TEXT",
  "ALTER TABLE dial_intents ADD COLUMN answered_at TEXT",
  "ALTER TABLE dial_intents ADD COLUMN hangup_at TEXT",
  "ALTER TABLE dial_intents ADD COLUMN duration_ms INTEGER",
  "CREATE INDEX IF NOT EXISTS idx_dial_intents_correlation ON dial_intents(correlation_id)",
  // Iter 40: per-user manual-dial capability.
  "ALTER TABLE users ADD COLUMN manual_dial INTEGER NOT NULL DEFAULT 0",
  // Iter 43: fine-grained ACL. JSON array of permission slugs.
  "ALTER TABLE users ADD COLUMN permissions TEXT",
  // Iter 44/45: carrier-level dial-plan prefix list + rewrite rules.
  "ALTER TABLE carriers ADD COLUMN dial_prefixes TEXT",
  "ALTER TABLE carriers ADD COLUMN dial_plan_rules TEXT",
  // Iter 49: per-campaign hopper + dial level.
  "ALTER TABLE campaigns ADD COLUMN hopper_level INTEGER NOT NULL DEFAULT 100",
  "ALTER TABLE campaigns ADD COLUMN dial_level REAL NOT NULL DEFAULT 1.0",
  // Iter 55: call recording path on the FS box.
  "ALTER TABLE dial_intents ADD COLUMN recording_path TEXT",
  // Iter 66: per-campaign AMD / voicemail-drop behaviour.
  "ALTER TABLE campaigns ADD COLUMN amd_action TEXT NOT NULL DEFAULT 'bridge'",
  "ALTER TABLE campaigns ADD COLUMN voicemail_path TEXT",
  // Iter 70: ViciDial-style list-order strategy.
  "ALTER TABLE campaigns ADD COLUMN list_order TEXT NOT NULL DEFAULT 'RANDOM'",
  // Iter 58: remote-agent in-flight attribution.
  "ALTER TABLE dial_intents ADD COLUMN remote_agent_id TEXT",
  "CREATE INDEX IF NOT EXISTS idx_dial_intents_remote_agent ON dial_intents(remote_agent_id, hangup_at)",
  // Iter 59: per-campaign scoping + structured extension for remotes.
  "ALTER TABLE remote_agents ADD COLUMN campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL",
  "ALTER TABLE remote_agents ADD COLUMN extension TEXT",
  "CREATE INDEX IF NOT EXISTS idx_remote_agents_campaign ON remote_agents(campaign_id)",
  // Iter 61: multi-role nodes.
  "ALTER TABLE nodes ADD COLUMN roles TEXT",
  "ALTER TABLE nodes ADD COLUMN is_self INTEGER NOT NULL DEFAULT 0",
  // Iter 62: phones pinned to a telephony node.
  "ALTER TABLE phones ADD COLUMN telephony_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL",
  "CREATE INDEX IF NOT EXISTS idx_phones_telephony_node ON phones(telephony_node_id)",
  // Iter 72: route plans attach CID groups.
  "ALTER TABLE route_plans ADD COLUMN cid_group_ids_json TEXT NOT NULL DEFAULT '[]'",
  // Iter 74: per-call carrier attribution.
  "ALTER TABLE dial_intents ADD COLUMN carrier_id TEXT",
  "CREATE INDEX IF NOT EXISTS idx_dial_intents_carrier ON dial_intents(carrier_id, hangup_at)",
  // Iter 90: Remote Agent backed by a real User.
  "ALTER TABLE remote_agents ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL",
  "CREATE INDEX IF NOT EXISTS idx_remote_agents_user ON remote_agents(user_id)",
  // Iter 91: cached lead timezone for TZ-aware list orders.
  "ALTER TABLE leads ADD COLUMN timezone TEXT",
  "CREATE INDEX IF NOT EXISTS idx_leads_timezone ON leads(timezone)",
  // Iter 94: per-campaign dialable_statuses whitelist (JSON array).
  "ALTER TABLE campaigns ADD COLUMN dialable_statuses TEXT NOT NULL DEFAULT '[\"NEW\",\"CALLED_NO_ANSWER\",\"BUSY\"]'",
  // Iter 125: per-lead preferred CID. When set, the pacer + the
  // manual-dial path use this caller-ID for this lead's outbound
  // calls instead of the route plan's cid_strategy. Useful for:
  //   - leads that prefer recognising a specific number from a
  //     prior conversation
  //   - imported leads that ship with their own preferred CID
  //   - per-state DIDs without going through a full CID group
  // NULL keeps the existing route-plan-driven behaviour.
  "ALTER TABLE leads ADD COLUMN preferred_cid TEXT",
  // Iter 122: AMD result column. dialplan dialeros-amd-route sets
  // a channel var dialeros_amd_result = HUMAN | MACHINE | NOTSURE
  // | UNKNOWN once amd_v2 runs at answer. fs-events extracts that
  // on CHANNEL_HANGUP_COMPLETE and writes it here so we can:
  //   - break down per-campaign AMD success in real time
  //   - audit voicemail-drop vs bridge-to-agent decisions
  //   - feed an ML model later if we ever predict-pace on AMD rate
  // NULL when the campaign didn't use amd_action=detect.
  "ALTER TABLE dial_intents ADD COLUMN amd_result TEXT",
  "CREATE INDEX IF NOT EXISTS idx_dial_intents_amd_result ON dial_intents(amd_result, campaign_id)",
  // Iter 116: inbound call queue. When the inbound-route hook says
  // "queue" (no available agent), we persist the parked caller
  // here so the FS queue extension can poll for an agent + so the
  // supervisor can see who's waiting. dispatched_to_user_id +
  // dispatched_at fill in when an agent becomes available; the
  // FS queue extension re-checks /api/internal/queue-poll every
  // N seconds and bridges as soon as one of these is non-null.
  // expired_at marks the row done (caller hung up, timed out,
  // or got connected).
  `CREATE TABLE IF NOT EXISTS inbound_queue (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL UNIQUE,
    from_phone TEXT NOT NULL,
    to_phone TEXT NOT NULL,
    in_group_id TEXT NOT NULL REFERENCES in_groups(id) ON DELETE CASCADE,
    classification TEXT,
    lead_id TEXT,
    enqueued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    dispatched_at TEXT,
    dispatched_to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    dispatched_extension TEXT,
    expired_at TEXT,
    expire_reason TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_inbound_queue_active ON inbound_queue(in_group_id, enqueued_at) WHERE expired_at IS NULL",
  "CREATE INDEX IF NOT EXISTS idx_inbound_queue_pending ON inbound_queue(call_id, dispatched_at, expired_at)",
];
