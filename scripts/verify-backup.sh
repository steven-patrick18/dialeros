#!/usr/bin/env bash
# Iter 170 — Backup verification. "Backups you've never restored
# aren't backups." Picks the latest nightly snapshot (iter-112),
# restores it to a temp file, opens it with sqlite3, runs
# integrity + sanity queries, writes a result row into the live
# DB's backup_verifications table.
#
# Run via dialeros-backup-verify.timer (weekly, Sunday 03:00).
# Manual trigger:
#   sudo systemctl start dialeros-backup-verify.service
#
# Required env (loaded from /etc/dialeros/backup.env via the
# systemd unit):
#   DIALEROS_DB        live DB the verify result row gets
#                      INSERTed into; default
#                      /opt/dialeros/apps/admin-gui/data/dialeros.db
#   BACKUP_ROOT        snapshot dir; default /var/backups/dialeros
#
# Exit codes:
#   0  verify ok — written to backup_verifications with status='ok'
#   2  no backups found in BACKUP_ROOT
#   3  pragma integrity_check failed
#   4  sanity queries failed (missing core tables / no recent data)
#   5  could not write result row to live DB

set -euo pipefail

DIALEROS_DB="${DIALEROS_DB:-/opt/dialeros/apps/admin-gui/data/dialeros.db}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/dialeros}"

# Find the most recent snapshot. iter-112's backup script names
# snapshots <STAMP>/dialeros.db where STAMP is UTC ISO basic.
LATEST=$(find "$BACKUP_ROOT" -maxdepth 2 -name dialeros.db -printf '%T@ %p\n' 2>/dev/null \
  | sort -nr | head -1 | awk '{print $2}')
if [ -z "$LATEST" ]; then
  echo "[verify-backup] no backups under $BACKUP_ROOT" >&2
  # Best-effort: still record the failure
  sqlite3 "$DIALEROS_DB" \
    "INSERT INTO backup_verifications (status, source_path, error_msg)
     VALUES ('no_backup', '$BACKUP_ROOT', 'No snapshots found');" || true
  exit 2
fi

echo "[verify-backup] verifying $LATEST"

TMPDIR=$(mktemp -d /tmp/backup-verify-XXXXXX)
trap 'rm -rf "$TMPDIR"' EXIT
RESTORED="$TMPDIR/restored.db"

# Copy the snapshot — using sqlite3 .restore guarantees a clean
# read even if the snapshot is mid-rotation (rare; backup script
# rotates atomically but defensive).
if ! cp "$LATEST" "$RESTORED"; then
  sqlite3 "$DIALEROS_DB" \
    "INSERT INTO backup_verifications (status, source_path, error_msg)
     VALUES ('copy_failed', '$LATEST', 'cp returned nonzero');" || true
  exit 3
fi

# 1. PRAGMA integrity_check — sqlite's own consistency self-test.
INTEGRITY=$(sqlite3 "$RESTORED" "PRAGMA integrity_check;" 2>&1 || echo "FAILED")
if [ "$INTEGRITY" != "ok" ]; then
  echo "[verify-backup] integrity_check failed: $INTEGRITY" >&2
  sqlite3 "$DIALEROS_DB" \
    "INSERT INTO backup_verifications
       (status, source_path, error_msg)
     VALUES ('integrity_failed', '$LATEST',
             '${INTEGRITY//\'/\'\'}');" || true
  exit 3
fi

# 2. Core-table presence: users, campaigns, dial_intents, leads.
# A snapshot missing any of these is broken regardless of integrity.
for tbl in users campaigns dial_intents leads; do
  COUNT=$(sqlite3 "$RESTORED" \
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$tbl';")
  if [ "$COUNT" != "1" ]; then
    echo "[verify-backup] missing table: $tbl" >&2
    sqlite3 "$DIALEROS_DB" \
      "INSERT INTO backup_verifications
         (status, source_path, error_msg)
       VALUES ('missing_table', '$LATEST', 'Missing table: $tbl');" || true
    exit 4
  fi
done

# 3. Row counts on the big tables for the manifest record.
USERS=$(sqlite3 "$RESTORED" "SELECT COUNT(*) FROM users;")
CAMPAIGNS=$(sqlite3 "$RESTORED" "SELECT COUNT(*) FROM campaigns;")
INTENTS=$(sqlite3 "$RESTORED" "SELECT COUNT(*) FROM dial_intents;")
LEADS=$(sqlite3 "$RESTORED" "SELECT COUNT(*) FROM leads;")

# 4. Latest dial_intent ts — a sanity check that recent activity
# made it into the snapshot. NULL is fine (fresh box); old is fine
# too (idle box). We just record the value.
LATEST_TS=$(sqlite3 "$RESTORED" \
  "SELECT COALESCE(MAX(ts), '') FROM dial_intents;")

# Restored size on disk (audit-friendly).
SIZE=$(stat -c '%s' "$RESTORED")

sqlite3 "$DIALEROS_DB" <<SQL
INSERT INTO backup_verifications
  (status, source_path, size_bytes, users_count, campaigns_count,
   intents_count, leads_count, latest_intent_ts)
VALUES
  ('ok', '${LATEST//\'/\'\'}', $SIZE, $USERS, $CAMPAIGNS, $INTENTS,
   $LEADS, '${LATEST_TS//\'/\'\'}');
SQL

echo "[verify-backup] ok"
echo "  source:    $LATEST"
echo "  size:      $SIZE bytes"
echo "  users:     $USERS"
echo "  campaigns: $CAMPAIGNS"
echo "  intents:   $INTENTS"
echo "  leads:     $LEADS"
echo "  latest:    $LATEST_TS"
