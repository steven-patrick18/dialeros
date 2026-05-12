#!/usr/bin/env python3
"""
Iter 144 — Recording retention prune.

Triggered by dialeros-prune-recordings.timer at 03:30 daily.

Thin wrapper around POST /api/internal/prune-recordings — the
heavy lifting (settings read, fs scan, unlink, DB clear) is in
the TypeScript route so secrets/encryption logic doesn't have to
be reimplemented in Python.

Reads env from /etc/dialeros/admin.env via the systemd unit:
    DIALEROS_ADMIN_URL          default http://127.0.0.1:1111
    KAMAILIO_INBOUND_TOKEN      shared secret (X-Inbound-Token)

The endpoint short-circuits when the retention toggle is off, so
running this nightly is safe even before an admin opts in — it
just no-ops with enabled:false.
"""

import json
import os
import sys
import urllib.request
import urllib.error


def main() -> int:
    admin_url = os.environ.get(
        "DIALEROS_ADMIN_URL", "http://127.0.0.1:1111"
    ).rstrip("/")
    token = os.environ.get("KAMAILIO_INBOUND_TOKEN", "")
    if not token:
        # /etc/dialeros/admin.env isn't created on every box; rather
        # than fail the timer every night, log + exit clean so the
        # journal stays readable. Admins who want the nightly tick
        # to actually run will see this message and know to create
        # the env file (same one ai-worker + daily-report use).
        print(
            "prune-recordings: skipped — KAMAILIO_INBOUND_TOKEN not set "
            "(see /etc/dialeros/admin.env). The 'Prune now' button on "
            "/settings/recording-retention works without this and uses "
            "the admin session cookie."
        )
        return 0

    req = urllib.request.Request(
        f"{admin_url}/api/internal/prune-recordings",
        method="POST",
        headers={"X-Inbound-Token": token},
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(
            f"ERROR: HTTP {e.code} {e.reason}: {e.read().decode('utf-8')}",
            file=sys.stderr,
        )
        return 3
    except urllib.error.URLError as e:
        print(f"ERROR: network: {e.reason}", file=sys.stderr)
        return 4

    # Pretty-print one-line summary for the journal, full JSON for
    # debugging on stdout (systemd captures both).
    enabled = payload.get("enabled")
    if not enabled:
        print(
            f"prune-recordings: skipped (enabled=false, "
            f"retention_days={payload.get('retention_days')})"
        )
    else:
        print(
            "prune-recordings: "
            f"scanned={payload.get('scanned')} "
            f"deleted={payload.get('deleted')} "
            f"freed_bytes={payload.get('freed_bytes')} "
            f"db_rows_cleared={payload.get('db_rows_cleared')} "
            f"retention_days={payload.get('retention_days')}"
        )
    errors = payload.get("errors") or []
    if errors:
        for line in errors:
            print(f"  ! {line}", file=sys.stderr)
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
