#!/usr/bin/env bash
# Iter 169 — Install msmtp as the system MTA so the iter-131
# daily-report timer can actually deliver email.
#
# Why msmtp not ssmtp:
#   - ssmtp is unmaintained since 2019; msmtp is actively
#     developed and supports modern TLS + SASL.
#   - msmtp-mta provides /usr/sbin/sendmail so the existing
#     send-daily-report.sh / send-test-email.sh scripts work
#     unchanged.
#
# Permissions trick: /etc/msmtprc is mode 0640 root:dialeros so
# the admin-gui (running as dialeros) can WRITE the file when the
# admin saves SMTP settings via /api/settings/smtp, but the file
# isn't world-readable (it carries the SMTP relay password
# plaintext — msmtp needs it; there's no way around that).

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: must run as root (use sudo)" >&2
  exit 1
fi

echo "[install-smtp] checking deps"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  msmtp msmtp-mta ca-certificates >/dev/null

# /usr/sbin/sendmail should now be the msmtp-mta symlink. Verify.
TARGET=$(readlink -f /usr/sbin/sendmail || echo unknown)
echo "[install-smtp] sendmail -> ${TARGET}"

# Prepare /etc/msmtprc — empty stub if missing, fix perms either way.
if [ ! -f /etc/msmtprc ]; then
  cat > /etc/msmtprc <<'EOF'
# /etc/msmtprc — managed by DialerOS admin-gui.
# Edit via the GUI at /settings/smtp instead of by hand; hand
# edits will be overwritten on the next save from the GUI.
#
# Until the admin configures a real relay, this file holds
# only a placeholder default that fails fast (no working
# server). The daily-report timer will exit non-zero with a
# clear error in the journal — that's the desired behavior.
defaults
auth           on
tls            on
tls_starttls   on
tls_trust_file /etc/ssl/certs/ca-certificates.crt
logfile        /var/log/msmtp.log

account        default
host           smtp.example.invalid
port           587
from           dialeros@example.invalid
user           CHANGEME
password       CHANGEME
EOF
fi
chgrp dialeros /etc/msmtprc
chmod 0640 /etc/msmtprc

# msmtp logs to /var/log/msmtp.log — pre-create with same perms
# so the dialeros user can append at runtime when the daily
# report fires.
touch /var/log/msmtp.log
chgrp dialeros /var/log/msmtp.log
chmod 0660 /var/log/msmtp.log

echo "[install-smtp] done."
echo
echo "Next steps:"
echo "  1. Open /settings/smtp in the admin GUI"
echo "  2. Enter your SMTP relay credentials (SendGrid / SES / Mailgun / your own)"
echo "  3. Save — the GUI writes /etc/msmtprc with the new values"
echo "  4. Click 'Send test email' to verify"
echo "  5. (Optional) enable the daily-report timer:"
echo "       systemctl enable --now dialeros-daily-report.timer"
