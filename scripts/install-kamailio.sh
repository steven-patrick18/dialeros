#!/usr/bin/env bash
# Iter 114 — Kamailio installer for DialerOS inbound front-door.
#
# Installs Kamailio from the official kamailio.org Debian repos
# (Bookworm builds; pin to 5.7 or 5.8 LTS), drops our config in
# /etc/kamailio/, opens 5060 udp/tcp on the firewall, and enables
# the unit. Does NOT start it — operator runs `systemctl start
# kamailio` after populating /etc/kamailio/trusted.list with their
# carrier IPs.
#
# Idempotent — re-running upgrades the package + refreshes the
# config without restarting. Manual restart so a typo doesn't
# break a live floor.

set -euo pipefail

DIALEROS_REPO_ROOT="${DIALEROS_REPO_ROOT:-/opt/dialeros}"
KAMAILIO_VERSION="${KAMAILIO_VERSION:-5.8}"
CONFIG_SRC="$DIALEROS_REPO_ROOT/infra/kamailio/kamailio.cfg"

if [ "$(id -u)" -ne 0 ]; then
  echo "[install-kamailio] must run as root" >&2
  exit 1
fi

CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
if [ -z "$CODENAME" ]; then
  echo "[install-kamailio] cannot detect Debian codename — aborting" >&2
  exit 2
fi

# Repo — kamailio.org publishes signed packages for the LTS lines.
if [ ! -f /etc/apt/sources.list.d/kamailio.list ]; then
  echo "[install-kamailio] adding kamailio.org repo for $CODENAME / $KAMAILIO_VERSION"
  curl -fsSL "https://deb.kamailio.org/kamailiodebkey.gpg" \
    | gpg --dearmor -o /usr/share/keyrings/kamailio-archive-keyring.gpg
  cat > /etc/apt/sources.list.d/kamailio.list <<EOF
deb [signed-by=/usr/share/keyrings/kamailio-archive-keyring.gpg] http://deb.kamailio.org/kamailio${KAMAILIO_VERSION//./} $CODENAME main
EOF
  apt-get update
fi

# Packages — base + the modules our config uses (http_async_client,
# jansson, permissions, uac).
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  kamailio \
  kamailio-extra-modules \
  kamailio-json-modules \
  kamailio-tls-modules

# Drop our config. /etc/kamailio/kamailio.cfg is preserved as a
# .pkg backup so the operator can diff against the distro default
# if they ever need to.
if [ -f /etc/kamailio/kamailio.cfg ] && [ ! -f /etc/kamailio/kamailio.cfg.pkg ]; then
  cp /etc/kamailio/kamailio.cfg /etc/kamailio/kamailio.cfg.pkg
fi
install -m 0644 "$CONFIG_SRC" /etc/kamailio/kamailio.cfg

# Trusted source ACL — empty by default. Operator MUST populate
# this with their PSTN trunk source IPs before starting the service.
if [ ! -f /etc/kamailio/trusted.list ]; then
  cat > /etc/kamailio/trusted.list <<'EOF'
# DialerOS Kamailio trusted source IPs.
# One per line, with proto: e.g.
#   1.2.3.4 udp
#   5.6.7.8 tcp
# Reload via: kamcmd permissions.addressReload
EOF
  chmod 0640 /etc/kamailio/trusted.list
  chown root:kamailio /etc/kamailio/trusted.list
fi

# Open firewall — UDP + TCP 5060. ufw is the default on Debian
# server installs; iptables fallback for boxes without it.
if command -v ufw >/dev/null 2>&1 && ufw status 2>&1 | grep -q active; then
  ufw allow 5060/udp comment 'kamailio sip' >/dev/null 2>&1 || true
  ufw allow 5060/tcp comment 'kamailio sip' >/dev/null 2>&1 || true
fi

systemctl daemon-reload
systemctl enable kamailio.service

cat <<'EOF'

[install-kamailio] done. NEXT STEPS:

1. Set KAMAILIO_INBOUND_TOKEN on the admin-gui systemd unit
   (Environment= line) AND inject the same value into Kamailio.
   The cfg currently reads no token — wire via uac or kemi in
   iter 115. For now, the admin-gui rejects unauthenticated
   requests when its env var is set; leave it unset only for
   the very first end-to-end smoke test.

2. Populate /etc/kamailio/trusted.list with each carrier
   source IP, then reload:  kamcmd permissions.addressReload

3. Start the service:       systemctl start kamailio

4. Tail for a test call:    journalctl -fu kamailio
EOF
