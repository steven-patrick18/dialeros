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

    -- Iter 170 — Backup verification history. Populated by
    -- /opt/dialeros/scripts/verify-backup.sh on its weekly run
    -- (and on manual triggers from /settings/backups). Operators
    -- audit "are our backups actually restorable?" from this
    -- table; failures are loud (the script exits non-zero and
    -- systemd surfaces it via failed-state).
    CREATE TABLE IF NOT EXISTS backup_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      status TEXT NOT NULL,
      source_path TEXT,
      size_bytes INTEGER,
      users_count INTEGER,
      campaigns_count INTEGER,
      intents_count INTEGER,
      leads_count INTEGER,
      latest_intent_ts TEXT,
      error_msg TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_backup_verifications_ts
      ON backup_verifications(ts DESC);

    -- Iter 175 — Skill-based routing v2.
    -- user_skills: many-to-many of users → skill tags. Replaces
    --   skill_tier for routing (tier stays for legacy reports).
    -- campaign_skills: skills a campaign requires. Pacer's
    --   getAvailableAgentsForCampaign filters out agents who
    --   lack any required skill.
    -- Skill is a free-form tag (UPPERCASE/digits/_/-).
    CREATE TABLE IF NOT EXISTS user_skills (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      skill TEXT NOT NULL,
      PRIMARY KEY (user_id, skill)
    );
    CREATE INDEX IF NOT EXISTS idx_user_skills_skill
      ON user_skills(skill);

    CREATE TABLE IF NOT EXISTS campaign_skills (
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      skill TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (campaign_id, skill)
    );

    -- Iter 174 — Per-campaign disposition palette. When set,
    -- the agent UI shows these codes instead of the iter-25
    -- hardcoded list; disposeAgentIntent uses lead_status_target
    -- here instead of the hardcoded DISPOSITION_TO_LEAD_STATUS.
    -- Empty palette = campaign falls back to the hardcoded list.
    CREATE TABLE IF NOT EXISTS campaign_dispositions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      lead_status_target TEXT NOT NULL,
      is_callback INTEGER NOT NULL DEFAULT 0,
      ordering INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(campaign_id, code)
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_dispositions_campaign
      ON campaign_dispositions(campaign_id);

    -- Iter 168 — Consent records. Searchable "they said yes" log
    -- for TCPA defensibility. Operators record express consent
    -- (written / oral / prior business) with evidence pointers.
    -- Revocation is a first-class state with its own timestamp.
    CREATE TABLE IF NOT EXISTS consent_records (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      consent_type TEXT NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT,
      granted_at TEXT NOT NULL,
      revoked_at TEXT,
      notes TEXT,
      granted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_consent_records_phone
      ON consent_records(phone);
    CREATE INDEX IF NOT EXISTS idx_consent_records_active
      ON consent_records(phone, revoked_at);

    -- Iter 157 — Per-campaign short survey. One survey per
    -- campaign (UNIQUE constraint). Questions are ordered and
    -- have a type that drives the agent wrap-up UI widget.
    -- survey_answers ties each answer to a dial_intent so the
    -- iter-159 export can join in campaign + lead + agent
    -- context cleanly.
    CREATE TABLE IF NOT EXISTS campaign_surveys (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL UNIQUE
        REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS survey_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      survey_id TEXT NOT NULL REFERENCES campaign_surveys(id) ON DELETE CASCADE,
      ordering INTEGER NOT NULL DEFAULT 0,
      question_text TEXT NOT NULL,
      question_type TEXT NOT NULL,
      options_json TEXT,
      is_required INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_survey_questions_survey
      ON survey_questions(survey_id);

    CREATE TABLE IF NOT EXISTS survey_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      dial_intent_id INTEGER NOT NULL REFERENCES dial_intents(id) ON DELETE CASCADE,
      survey_id TEXT NOT NULL REFERENCES campaign_surveys(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
      answer_text TEXT,
      answered_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_survey_answers_intent
      ON survey_answers(dial_intent_id);
    CREATE INDEX IF NOT EXISTS idx_survey_answers_question
      ON survey_answers(question_id);

    -- Iter 150 — Sound Board (audio library). Central catalogue
    -- referenced by call menus, voicemail drops, in-group greetings,
    -- hold music. Files are stored at /var/lib/dialeros/audio/library/<id>.wav
    -- after ffmpeg normalization to 8kHz mono PCM .wav.
    CREATE TABLE IF NOT EXISTS audio_files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'menu_prompt',
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      duration_ms INTEGER,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audio_files_category
      ON audio_files(category);

    -- Iter 149 — Call Menu (IVR) tables.
    -- call_menus: one row per menu definition.
    -- call_menu_options: digit -> action mapping. Multiple per menu.
    -- Both tables back the /call-menus admin pages and the iter 150
    -- dialplan generator. iter 151 wires the connection columns
    -- (dids.call_menu_id, in_groups.overflow_call_menu_id, etc).
    CREATE TABLE IF NOT EXISTS call_menus (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      prompt_path TEXT,
      prompt_tts_text TEXT,
      timeout_seconds INTEGER NOT NULL DEFAULT 5,
      max_retries INTEGER NOT NULL DEFAULT 3,
      invalid_audio_path TEXT,
      timeout_audio_path TEXT,
      default_action_type TEXT NOT NULL DEFAULT 'hangup',
      default_action_value TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS call_menu_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_menu_id TEXT NOT NULL REFERENCES call_menus(id) ON DELETE CASCADE,
      digit TEXT NOT NULL,
      ordering INTEGER NOT NULL DEFAULT 0,
      action_type TEXT NOT NULL,
      action_value TEXT,
      label TEXT,
      -- Iter 151 ViciDial parity:
      -- dispo_code  — optional per-option disposition override. If
      --               set, callers who pick this digit get the
      --               dial_intent row stamped with this code, even
      --               if the option routes to a queue and the agent
      --               doesn't manually dispose later. Used by ViciDial
      --               for "press 9 to be removed from list" -> 'DNC'.
      -- tod_start   — time-of-day window start (HH:MM, 24h).
      -- tod_end     — time-of-day window end (HH:MM). Options outside
      --               their TOD window are ignored at dial time and
      --               the caller falls to the default action. Both
      --               NULL means "always active".
      dispo_code TEXT,
      tod_start TEXT,
      tod_end TEXT,
      UNIQUE(call_menu_id, digit)
    );

    -- Iter 151 — DTMF press log. Every digit press during a menu
    -- session is appended here. The iter 153 dialplan generator
    -- emits a lua send_event after each play_and_get_digits so
    -- analytics in iter 154 can compute pick rate, timeout rate,
    -- abandon-during-menu rate.
    CREATE TABLE IF NOT EXISTS call_menu_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      call_menu_id TEXT NOT NULL REFERENCES call_menus(id) ON DELETE CASCADE,
      dial_intent_id INTEGER REFERENCES dial_intents(id) ON DELETE SET NULL,
      call_uuid TEXT,
      event_type TEXT NOT NULL,  -- 'entered' | 'pressed' | 'timeout' | 'invalid' | 'repeated' | 'completed'
      digit TEXT,
      action_taken TEXT,         -- mirrors call_menu_options.action_type when event_type='pressed'
      retry_count INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_call_menu_log_menu
      ON call_menu_log(call_menu_id);
    CREATE INDEX IF NOT EXISTS idx_call_menu_log_intent
      ON call_menu_log(dial_intent_id);
    CREATE INDEX IF NOT EXISTS idx_call_menu_log_ts
      ON call_menu_log(ts);

    CREATE INDEX IF NOT EXISTS idx_call_menu_options_menu
      ON call_menu_options(call_menu_id);

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
  // Iter 146 — origin of the disposition: 'agent' (manual wrap-up),
  // 'auto' (system-inferred at hangup/backfill), or NULL (legacy
  // pre-iter-146 row that was never re-tagged).
  "ALTER TABLE dial_intents ADD COLUMN disposition_origin TEXT",
  // Iter 149 — Call Menu (IVR) connection columns. NULL means
  // 'no menu wired' for each target; iter 151 reads these to
  // decide whether inbound + overflow routes hit a menu.
  // iter 149 had ALTER TABLE dids ADD COLUMN call_menu_id TEXT here,
  // but there's no top-level dids table — DIDs are rows in the
  // in_group_dids join table. DID-direct-to-menu wiring is
  // deferred to iter 151 (extend in_group_dids or add a new table).
  // Iter 153 — entry-time call menu (greets the caller before
  // the queue dispatch attempts an agent pick). Distinct from
  // overflow_call_menu_id (fires only when no agent available).
  "ALTER TABLE in_groups ADD COLUMN entry_call_menu_id TEXT",
  // Iter 154 — Campaign on-answer behaviors (ViciDial parity).
  // Adds two new amd_action values ('call_menu' and 'audio_drop')
  // plus the sub-action knobs that detect mode uses to branch on
  // amd_v2's HUMAN/MACHINE verdict. Mirrors ViciDial's special
  // extensions: 8366 (call menu transfer), 8369 (in-group transfer),
  // 8373 (drop with audio file).
  "ALTER TABLE campaigns ADD COLUMN on_answer_call_menu_id TEXT",
  "ALTER TABLE campaigns ADD COLUMN audio_drop_path TEXT",
  "ALTER TABLE campaigns ADD COLUMN amd_human_action TEXT",
  "ALTER TABLE campaigns ADD COLUMN amd_human_call_menu_id TEXT",
  "ALTER TABLE campaigns ADD COLUMN amd_machine_action TEXT",
  "ALTER TABLE campaigns ADD COLUMN amd_machine_call_menu_id TEXT",
  "ALTER TABLE campaigns ADD COLUMN amd_machine_audio_path TEXT",
  // Iter 167 — Recording-notice playback at answer for
  // two-party-consent compliance. Pacer pushes the path as a
  // channel var; dialeros-record-and-bridge plays it before
  // starting record_session + bridging.
  "ALTER TABLE campaigns ADD COLUMN recording_notice_audio_path TEXT",
  "ALTER TABLE in_groups ADD COLUMN overflow_call_menu_id TEXT",
  "ALTER TABLE in_groups ADD COLUMN after_hours_call_menu_id TEXT",
  "ALTER TABLE campaigns ADD COLUMN no_agent_call_menu_id TEXT",
  // Iter 151 — ViciDial parity for call menu options.
  "ALTER TABLE call_menu_options ADD COLUMN dispo_code TEXT",
  "ALTER TABLE call_menu_options ADD COLUMN tod_start TEXT",
  "ALTER TABLE call_menu_options ADD COLUMN tod_end TEXT",
  // Iter 176 — QA flag on dial_intents. Supervisors flag a
  // call mid-monitor for later review; the /reports/flagged-calls
  // page is the QA work queue.
  "ALTER TABLE dial_intents ADD COLUMN flagged_for_qa INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE dial_intents ADD COLUMN flagged_at TEXT",
  "ALTER TABLE dial_intents ADD COLUMN flagged_by_user_id TEXT",
  "ALTER TABLE dial_intents ADD COLUMN flag_reason TEXT",
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
  // Iter 135 — post-call AI pipeline. Filled by an operator-
  // configured worker that polls /api/internal/ai-pending,
  // downloads the recording, runs it through their chosen STT
  // + LLM, and POSTs the result back via
  // /api/internal/ai-process. ai_processed_at is the latch —
  // pending list excludes rows where it's non-NULL so the
  // worker doesn't loop on the same recording.
  "ALTER TABLE dial_intents ADD COLUMN transcript_text TEXT",
  "ALTER TABLE dial_intents ADD COLUMN ai_summary TEXT",
  "ALTER TABLE dial_intents ADD COLUMN ai_processed_at TEXT",
  // Partial index — only the small set of "answered + recorded
  // + not yet AI'd" rows. Worker query stays sub-millisecond
  // even on multi-million-row dial_intents tables.
  "CREATE INDEX IF NOT EXISTS idx_dial_intents_ai_pending ON dial_intents(ai_processed_at, hangup_at) WHERE recording_path IS NOT NULL AND ai_processed_at IS NULL",
  // Iter 138 — structured AI outputs alongside the free-text
  // transcript + summary from iter 135. The worker calls the
  // local LLM a second time with a JSON-only prompt and posts
  // these back via the extended /api/internal/ai-process body.
  //   ai_sentiment: one of 'positive' | 'neutral' | 'negative'
  //     | 'mixed' | NULL when the LLM couldn't classify.
  //   ai_flags: JSON-encoded string[] of compliance markers,
  //     drawn from a fixed vocab (DNC_REQUESTED, HOSTILE,
  //     WRONG_NUMBER, RECORDING_OBJECTION, CALLBACK_PROMISED,
  //     SALE_CONFIRMED, VOICEMAIL_DROPPED). Operator can
  //     filter / report on these in iter 139.
  "ALTER TABLE dial_intents ADD COLUMN ai_sentiment TEXT",
  "ALTER TABLE dial_intents ADD COLUMN ai_flags TEXT",
  "CREATE INDEX IF NOT EXISTS idx_dial_intents_ai_sentiment ON dial_intents(ai_sentiment) WHERE ai_sentiment IS NOT NULL",

  // Iter 138 — FTS5 virtual table mirroring transcript_text +
  // ai_summary. Lets operators search every recorded call for
  // a phrase ("my credit card", "remove me from your list",
  // etc.). content='dial_intents' makes the FTS table a
  // contentless mirror — the real text only lives in
  // dial_intents; the FTS table holds just the index.
  //
  // Three sync triggers keep the index aligned. FTS5's
  // 'delete' command takes the OLD values so the index can
  // remove the right rows even when the source row is gone.
  `CREATE VIRTUAL TABLE IF NOT EXISTS dial_intents_fts USING fts5(
    transcript_text,
    ai_summary,
    content='dial_intents',
    content_rowid='id'
  )`,
  `CREATE TRIGGER IF NOT EXISTS dial_intents_fts_insert AFTER INSERT ON dial_intents
   WHEN new.transcript_text IS NOT NULL OR new.ai_summary IS NOT NULL
   BEGIN
     INSERT INTO dial_intents_fts(rowid, transcript_text, ai_summary)
     VALUES (new.id, new.transcript_text, new.ai_summary);
   END`,
  `CREATE TRIGGER IF NOT EXISTS dial_intents_fts_update AFTER UPDATE OF transcript_text, ai_summary ON dial_intents
   BEGIN
     INSERT INTO dial_intents_fts(dial_intents_fts, rowid, transcript_text, ai_summary)
     VALUES ('delete', old.id, old.transcript_text, old.ai_summary);
     INSERT INTO dial_intents_fts(rowid, transcript_text, ai_summary)
     VALUES (new.id, new.transcript_text, new.ai_summary);
   END`,
  `CREATE TRIGGER IF NOT EXISTS dial_intents_fts_delete AFTER DELETE ON dial_intents
   BEGIN
     INSERT INTO dial_intents_fts(dial_intents_fts, rowid, transcript_text, ai_summary)
     VALUES ('delete', old.id, old.transcript_text, old.ai_summary);
   END`,
  // Iter 140 — per-campaign voicemail-drop tuning. JSON
  // override of the iter-139 wait-for-beep dialplan params.
  // Shape: {silence_thresh, silence_hits, listen_hits,
  //         silence_timeout_ms, beep_grace_ms}
  // NULL = use the dialplan defaults (256 / 25 / 4 / 30000 /
  // 750). Operator tunes via the campaign Detail tab when a
  // specific carrier's machines have unusual greeting cadence.
  "ALTER TABLE campaigns ADD COLUMN voicemail_config TEXT",
  // Iter 178 — Inbound-to-outbound callback. Caller parked in the
  // hold queue presses the configured DTMF (default '9'); the
  // queue-poll endpoint records the row here, expires the
  // inbound_queue row with reason='callback_requested', and a
  // future iter's worker will originate the outbound leg.
  //
  // status: 'pending' (just captured) | 'dispatched' (worker
  //   originated the outbound leg) | 'completed' (caller
  //   reconnected to an agent) | 'expired' (TTL passed without a
  //   dispatch) | 'cancelled' (supervisor killed it) |
  //   'failed' (origination failed)
  //
  // The row keeps from_phone (callback number — by default the
  // caller's ANI) + the original in_group_id so the future
  // worker can route the callback through the same queue.
  `CREATE TABLE IF NOT EXISTS callback_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id TEXT NOT NULL,
    in_group_id TEXT NOT NULL,
    from_phone TEXT NOT NULL,
    to_phone TEXT,
    requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    dispatched_at TEXT,
    dispatched_user_id TEXT,
    completed_at TEXT,
    expire_reason TEXT,
    cancelled_by_user_id TEXT,
    notes TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_callback_status ON callback_requests(status, requested_at)",
  "CREATE INDEX IF NOT EXISTS idx_callback_phone ON callback_requests(from_phone, requested_at)",
  "CREATE INDEX IF NOT EXISTS idx_callback_in_group ON callback_requests(in_group_id, status)",
  // Iter 179 — ACD priority queues. Per-DID priority band 0..9
  // where 0 is highest. Default 5 keeps existing DIDs at parity
  // with each other. The inbound-queue row copies the DID's
  // priority at enqueue time so a later priority change on the
  // DID doesn't reshuffle in-flight callers (predictable ETAs).
  "ALTER TABLE in_group_dids ADD COLUMN priority INTEGER NOT NULL DEFAULT 5",
  "ALTER TABLE inbound_queue ADD COLUMN priority INTEGER NOT NULL DEFAULT 5",
  // Compound index for the priority-aware queue picker: order by
  // (in_group_id, priority ASC, enqueued_at ASC) restricted to
  // still-waiting rows (no dispatched, no expired).
  "CREATE INDEX IF NOT EXISTS idx_inbound_queue_priority ON inbound_queue(in_group_id, priority, enqueued_at) WHERE dispatched_at IS NULL AND expired_at IS NULL",
  // Iter 180 — Business hours + timezone on in-groups. NULL
  // business_hours_json means "24/7 open" (default for legacy
  // rows). When non-NULL, JSON shape:
  //   { mon: {open:"09:00",close:"17:00"} | null, tue: ..., ... }
  // Each day-of-week key (mon..sun) is either an {open, close}
  // window (HH:MM 24h) or null = closed that day.
  // timezone is an IANA name (e.g. 'America/New_York'); default
  // 'UTC' so legacy rows still behave deterministically.
  "ALTER TABLE in_groups ADD COLUMN business_hours_json TEXT",
  "ALTER TABLE in_groups ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'",
  // Iter 180 — Org-wide holiday calendar. A holiday_date that
  // matches today (in the in-group's timezone) forces after-hours
  // routing for every in-group. Enabled flag lets ops disable a
  // holiday without losing the row (e.g. business decides to open
  // on a federal holiday). YYYY-MM-DD calendar dates, no time.
  `CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    holiday_date TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (holiday_date)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_holidays_date_enabled ON holidays(holiday_date, enabled)",
  // Iter 181 — Multi-org foundation (Phase F). Pre-1.0 the
  // product was implicitly single-tenant; iter 181 lays the
  // schema for true multi-tenancy. Resources will gain org_id
  // in subsequent iters with WHERE filters in listing queries.
  // For now: every user is tagged with an org; lists remain
  // unfiltered (legacy "shared visibility" — explicit until the
  // propagation pass).
  //
  // settings_json holds per-org config that previously lived in
  // app_settings (recording retention, freq caps, smtp, etc.).
  // For iter 181 it stays empty; future iter shifts those keys
  // under here when an operator opts in to per-org overrides.
  `CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    settings_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  // Seed the default org. Idempotent via OR IGNORE — re-running
  // migrations after upgrade is safe.
  "INSERT OR IGNORE INTO orgs (id, slug, name) VALUES ('default', 'default', 'Default Organization')",
  // Add org_id to users. Nullable for the ALTER (SQLite can't
  // add NOT NULL without a default to existing rows); we backfill
  // immediately below + treat NULL as 'default' in code.
  "ALTER TABLE users ADD COLUMN org_id TEXT",
  "UPDATE users SET org_id = 'default' WHERE org_id IS NULL",
  "CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id)",
  // Iter 182 — Cross-cluster recording awareness. Each recording's
  // .wav lives on the node whose FreeSWITCH ran the call. In
  // single-node deploys this is the admin-gui node (current),
  // but multi-node clusters need to know WHICH node owns the
  // file. recording_node_id is set at insertDialIntent time
  // from getSelfNode()?.id (the pacer's local node).
  //
  // recording_bytes caches the file size at record-finish so the
  // /reports/recordings rollup doesn't have to stat every file.
  // NULL = unknown yet (file still being written, or pre-iter-182
  // legacy row).
  "ALTER TABLE dial_intents ADD COLUMN recording_node_id TEXT",
  "ALTER TABLE dial_intents ADD COLUMN recording_bytes INTEGER",
  "CREATE INDEX IF NOT EXISTS idx_dial_intents_recording_node ON dial_intents(recording_node_id) WHERE recording_path IS NOT NULL",
  // Iter 183 — Parallel race-to-answer SIP forking. Two-to-four
  // carriers race the same INVITE in parallel; whichever returns
  // 200 OK first wins, the loser legs get CANCEL'd by FS.
  // VOICEMAIL-DROP CAMPAIGNS ONLY — the pacer enforces this
  // (live-agent races would dual-ring a human, which is a UX +
  // compliance trap). parallel_carriers_json is a JSON array of
  // carrier IDs (length 2-4); empty / null = legacy single-carrier
  // behaviour.
  "ALTER TABLE route_plans ADD COLUMN parallel_race_enabled INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE route_plans ADD COLUMN parallel_carriers_json TEXT NOT NULL DEFAULT '[]'",
  // Per-race outcome row, written at originate-time (winner +
  // PDD patched in by fs-events on CHANNEL_ANSWER). Powers the
  // /reports/carrier-race-stats per-carrier win-rate report.
  `CREATE TABLE IF NOT EXISTS carrier_race_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    correlation_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    route_plan_id TEXT NOT NULL,
    raced_carriers_json TEXT NOT NULL,
    winner_carrier_id TEXT,
    winner_pdd_ms INTEGER,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    decided_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_race_correlation ON carrier_race_outcomes(correlation_id)",
  "CREATE INDEX IF NOT EXISTS idx_race_winner ON carrier_race_outcomes(winner_carrier_id) WHERE winner_carrier_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS idx_race_campaign ON carrier_race_outcomes(campaign_id, started_at)",
];
