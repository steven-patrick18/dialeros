#!/usr/bin/env tsx
// Iter 184 — sqlite → postgres export CLI.
//
// Reads the live sqlite database, emits a fully-translated
// .sql file to stdout that recreates the schema + data in
// postgres. Use:
//
//   pnpm tsx scripts/export-to-postgres.ts > dialeros-pg-dump.sql
//   psql $DATABASE_URL -f dialeros-pg-dump.sql
//
// What lands cleanly:
//   - Every CREATE TABLE from CREATE_TABLES_SQL
//   - Every additive ALTER TABLE / CREATE INDEX from COLUMN_MIGRATIONS
//   - Every data row from every table (multi-row INSERT batches)
//   - Sequence resets so identity columns continue past the
//     imported max(id)
//
// What needs manual work after import:
//   - FTS5 → tsvector mapping (transcripts search) — see TODO
//     comments in the dump
//   - Any place the application uses sqlite-specific functions
//     at runtime (strftime/datetime inside live queries) — those
//     are addressed in iter 188 when the actual pg query backend
//     ships

import { createRequire } from 'node:module';
import { CREATE_TABLES_SQL, COLUMN_MIGRATIONS } from '../services/control-plane/src/db-schema.ts';
import {
  rowsToInsertBatch,
  resetSequenceForTable,
  translateAlterAddColumn,
  translateCreateStmt,
} from '../services/control-plane/src/postgres-export.ts';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    prepare(sql: string): {
      all(...args: unknown[]): unknown[];
      get(...args: unknown[]): unknown;
    };
  };
};

const DB_PATH =
  process.env.DIALEROS_DB ?? '/opt/dialeros/apps/admin-gui/data/dialeros.db';
const BATCH_SIZE = 500;

// Tables that have an INTEGER PRIMARY KEY AUTOINCREMENT — their
// sequence needs resetting after bulk-INSERT or the next pg
// INSERT will collide. Listed manually so we don't have to parse
// the schema. Update when new AUTOINCREMENT tables land.
const AUTOINC_TABLES: Array<{ table: string; pkCol: string }> = [
  { table: 'provisioning_logs', pkCol: 'id' },
  { table: 'audit_events', pkCol: 'id' },
  { table: 'dial_intents', pkCol: 'id' },
  { table: 'call_menu_log', pkCol: 'id' },
  { table: 'survey_answers', pkCol: 'id' },
  { table: 'consent_records', pkCol: 'id' },
  { table: 'backup_verifications', pkCol: 'id' },
  { table: 'callback_requests', pkCol: 'id' },
  { table: 'holidays', pkCol: 'id' },
  { table: 'carrier_race_outcomes', pkCol: 'id' },
];

function emit(s: string) {
  process.stdout.write(s + '\n');
}

function main() {
  emit('-- DialerOS sqlite → postgres export');
  emit(`-- Source: ${DB_PATH}`);
  emit(`-- Generated: ${new Date().toISOString()}`);
  emit('-- Apply with: psql $DATABASE_URL -f <this-file>');
  emit('');
  emit('BEGIN;');
  emit('');

  // ---------- 1. Schema: CREATE TABLES ----------
  emit('-- ===== Schema (CREATE TABLES) =====');
  // CREATE_TABLES_SQL is a single multi-statement string. Split
  // on ; followed by a blank line + uppercase CREATE — the
  // formatting we control in db-schema.ts.
  const createStmts = CREATE_TABLES_SQL.split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of createStmts) {
    const { pg, warnings } = translateCreateStmt(stmt);
    for (const w of warnings) emit(`-- WARN: ${w}`);
    emit(pg + ';');
    emit('');
  }

  // ---------- 2. Schema: COLUMN_MIGRATIONS ----------
  emit('-- ===== Schema (COLUMN_MIGRATIONS) =====');
  for (const stmt of COLUMN_MIGRATIONS) {
    let result;
    if (/^\s*ALTER\s+TABLE\s+/i.test(stmt)) {
      result = translateAlterAddColumn(stmt);
    } else {
      // UPDATE / INSERT / CREATE INDEX / etc — most pass through
      // unchanged. translateCreateStmt also handles the
      // datetime/strftime rewrites used in seed INSERTs.
      result = translateCreateStmt(stmt);
    }
    for (const w of result.warnings) emit(`-- WARN: ${w}`);
    const pg = result.pg.trim();
    emit(pg.endsWith(';') ? pg : pg + ';');
  }
  emit('');

  // ---------- 3. Data ----------
  emit('-- ===== Data =====');
  const db = new DatabaseSync(DB_PATH);
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type='table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE '%_fts'
          AND name NOT LIKE '%_fts_%'
        ORDER BY name`,
    )
    .all() as Array<{ name: string }>;

  for (const { name } of tables) {
    const rows = db.prepare(`SELECT * FROM ${name}`).all() as Array<
      Record<string, unknown>
    >;
    if (rows.length === 0) {
      emit(`-- ${name}: (empty)`);
      continue;
    }
    emit(`-- ${name}: ${rows.length} rows`);
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      emit(rowsToInsertBatch(name, batch));
    }
    emit('');
  }

  // ---------- 4. Sequence resets ----------
  emit('-- ===== Sequence resets =====');
  for (const { table, pkCol } of AUTOINC_TABLES) {
    emit(resetSequenceForTable(table, pkCol));
  }
  emit('');

  emit('COMMIT;');
  emit('-- End of DialerOS sqlite → postgres export');
}

main();
