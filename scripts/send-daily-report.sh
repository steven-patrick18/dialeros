#!/usr/bin/env bash
# Iter 131 — fetch the DialerOS daily summary HTML and pipe it to
# sendmail. Designed to be invoked from a systemd timer once per
# day (default 06:00 local; override via the .timer's OnCalendar).
#
# Env (loaded by the systemd unit from /etc/dialeros/admin.env):
#   KAMAILIO_INBOUND_TOKEN  — same shared secret the inbound-route
#                             + xml_curl + daily-report endpoints
#                             use. Without it the report endpoint
#                             accepts unauthenticated requests
#                             (dev mode), but production must set
#                             it.
#   DIALEROS_REPORT_TO      — comma-separated list of recipient
#                             email addresses (To: header).
#   DIALEROS_REPORT_FROM    — From: header. Default
#                             "dialeros@$(hostname -f)".
#   DIALEROS_ADMIN_URL      — admin-gui base URL. Default
#                             http://127.0.0.1:1111.
#
# Exit codes:
#   0 — sent
#   2 — required env missing
#   3 — fetch failed
#   4 — sendmail failed

set -euo pipefail

if [ -z "${DIALEROS_REPORT_TO:-}" ]; then
  echo "[daily-report] DIALEROS_REPORT_TO not set" >&2
  exit 2
fi

ADMIN_URL="${DIALEROS_ADMIN_URL:-http://127.0.0.1:1111}"
FROM="${DIALEROS_REPORT_FROM:-dialeros@$(hostname -f 2>/dev/null || hostname)}"
TOKEN="${KAMAILIO_INBOUND_TOKEN:-}"

TMPDIR=$(mktemp -d /tmp/dialeros-report.XXXXXX)
trap 'rm -rf "$TMPDIR"' EXIT

# Pull the HTML. Auth via X-Inbound-Token; if unset the endpoint
# warns server-side but accepts. curl --fail bubbles non-2xx as
# exit 22 → we catch it.
if [ -n "$TOKEN" ]; then
  curl --fail -sS \
    -H "X-Inbound-Token: $TOKEN" \
    -o "$TMPDIR/body.html" \
    "$ADMIN_URL/api/internal/daily-report" || {
    echo "[daily-report] curl failed" >&2
    exit 3
  }
else
  curl --fail -sS \
    -o "$TMPDIR/body.html" \
    "$ADMIN_URL/api/internal/daily-report" || {
    echo "[daily-report] curl failed" >&2
    exit 3
  }
fi

# Compose the RFC-5322 message. multipart-alternative would be
# nicer but every modern client renders text/html cleanly, and
# the plaintext fallback for the kind of operator who runs a
# DialerOS box is the JSON endpoint they already have.
SUBJECT="DialerOS daily summary — $(date -u +'%Y-%m-%d')"
{
  echo "From: $FROM"
  echo "To: $DIALEROS_REPORT_TO"
  echo "Subject: $SUBJECT"
  echo "MIME-Version: 1.0"
  echo "Content-Type: text/html; charset=UTF-8"
  echo "Content-Transfer-Encoding: 8bit"
  echo ""
  cat "$TMPDIR/body.html"
} | /usr/sbin/sendmail -oi -t || {
  echo "[daily-report] sendmail failed" >&2
  exit 4
}

echo "[daily-report] sent to $DIALEROS_REPORT_TO"
