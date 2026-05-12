#!/usr/bin/env bash
# Iter 112 — nightly backup of the sqlite database + recordings dir.
#
# Run via cron at 02:00 local time. Keeps 14 daily snapshots locally
# under $BACKUP_ROOT (rotated by `find -mtime +14 -delete`). If the
# REMOTE_RSYNC_TARGET env var is set, rsyncs the latest snapshot to
# that target (s3:// is NOT supported here — use rclone via a wrapper).
#
# Required env (override at the crontab line or via /etc/dialeros/backup.env):
#   DIALEROS_DB        — path to dialeros.db (default /var/lib/dialeros/dialeros.db)
#   RECORDINGS_ROOT    — recordings dir (default /var/lib/dialeros/recordings)
#   BACKUP_ROOT        — local snapshot root (default /var/backups/dialeros)
#   REMOTE_RSYNC_TARGET (optional) — rsync target like user@host:/srv/dialeros-backups
#
# Exit codes:
#   0 = success
#   2 = required source path missing
#   3 = sqlite copy failed
#   4 = rsync failed (local backup still kept)

set -euo pipefail

DIALEROS_DB="${DIALEROS_DB:-/var/lib/dialeros/dialeros.db}"
RECORDINGS_ROOT="${RECORDINGS_ROOT:-/var/lib/dialeros/recordings}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/dialeros}"

if [ ! -f "$DIALEROS_DB" ]; then
  echo "[backup] db not found at $DIALEROS_DB" >&2
  exit 2
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"

# Use `sqlite3 .backup` rather than `cp` so we get a consistent
# snapshot even if the admin-gui is mid-write. Falls back to a
# straight cp if sqlite3 isn't installed (warn — operator should
# install it).
if command -v sqlite3 >/dev/null 2>&1; then
  if ! sqlite3 "$DIALEROS_DB" ".backup '$DEST/dialeros.db'"; then
    echo "[backup] sqlite3 .backup failed" >&2
    exit 3
  fi
else
  echo "[backup] WARN: sqlite3 not installed, falling back to cp" >&2
  if ! cp "$DIALEROS_DB" "$DEST/dialeros.db"; then
    exit 3
  fi
fi

# Recordings — rsync into dated dir, hardlink against the previous
# snapshot for storage efficiency (`-link-dest`). When the recordings
# tree doesn't exist yet (fresh install) just skip — not an error.
if [ -d "$RECORDINGS_ROOT" ]; then
  PREV=$(ls -1d "$BACKUP_ROOT"/*/ 2>/dev/null | grep -v "$STAMP/" | tail -1 || true)
  if [ -n "$PREV" ] && [ -d "$PREV/recordings" ]; then
    rsync -a --link-dest="$PREV/recordings" "$RECORDINGS_ROOT/" "$DEST/recordings/"
  else
    rsync -a "$RECORDINGS_ROOT/" "$DEST/recordings/"
  fi
fi

echo "[backup] snapshot ready: $DEST"

# Rotate — keep 14 days locally.
find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime +14 -exec rm -rf {} +

# Optional offsite rsync.
if [ -n "${REMOTE_RSYNC_TARGET:-}" ]; then
  if ! rsync -az --delete "$BACKUP_ROOT/" "$REMOTE_RSYNC_TARGET/"; then
    echo "[backup] remote rsync to $REMOTE_RSYNC_TARGET failed (local snapshot kept)" >&2
    exit 4
  fi
  echo "[backup] mirrored to $REMOTE_RSYNC_TARGET"
fi
