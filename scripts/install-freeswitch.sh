#!/usr/bin/env bash
# Iter 28 — bootstrap FreeSWITCH on a Debian 12 host using a SignalWire
# token. Reads the token from the SIGNALWIRE_TOKEN env var (set by the
# admin GUI when it spawns this script). Writes a minimal event_socket
# config so the control plane can talk to FreeSWITCH on localhost.
#
# Idempotent — re-running on an already-installed host just verifies +
# (re)starts the service. Safe to invoke after every boot if needed.

set -euo pipefail
LOG_PREFIX='[install-freeswitch]'

log() { echo "$LOG_PREFIX $*"; }
fail() { echo "$LOG_PREFIX ERROR: $*" >&2; exit 1; }

if [[ "$EUID" -ne 0 ]]; then
  fail "must be run as root (use sudo)"
fi

if [[ -z "${SIGNALWIRE_TOKEN:-}" ]]; then
  fail "SIGNALWIRE_TOKEN env var is not set"
fi

# === step 1: SignalWire repo + auth ===
log "writing SignalWire apt auth + repo"
mkdir -p /etc/apt/auth.conf.d /usr/share/keyrings
cat > /etc/apt/auth.conf.d/signalwire.conf <<EOF
machine freeswitch.signalwire.com
login signalwire
password $SIGNALWIRE_TOKEN
EOF
chmod 600 /etc/apt/auth.conf.d/signalwire.conf

if [[ ! -s /usr/share/keyrings/signalwire-freeswitch-repo.gpg ]]; then
  log "fetching SignalWire repo signing key"
  curl -fsSL --user "signalwire:$SIGNALWIRE_TOKEN" \
    -o /usr/share/keyrings/signalwire-freeswitch-repo.gpg \
    https://freeswitch.signalwire.com/repo/deb/debian-release/signalwire-freeswitch-repo.gpg
fi

cat > /etc/apt/sources.list.d/freeswitch.list <<'EOF'
deb [signed-by=/usr/share/keyrings/signalwire-freeswitch-repo.gpg] https://freeswitch.signalwire.com/repo/deb/debian-release/ bookworm main
deb-src [signed-by=/usr/share/keyrings/signalwire-freeswitch-repo.gpg] https://freeswitch.signalwire.com/repo/deb/debian-release/ bookworm main
EOF

log "apt-get update"
apt-get update

# === step 2: install ===
if ! dpkg -l freeswitch-meta-vanilla >/dev/null 2>&1; then
  log "apt-get install freeswitch-meta-vanilla (this can take a few minutes)"
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    freeswitch-meta-vanilla
else
  log "freeswitch-meta-vanilla already installed"
fi

# === step 3: minimal event_socket config (localhost only) ===
ESL_CONF=/etc/freeswitch/autoload_configs/event_socket.conf.xml
log "writing $ESL_CONF (localhost-only ESL)"
cat > "$ESL_CONF" <<'EOF'
<configuration name="event_socket.conf" description="Socket Client">
  <settings>
    <param name="nat-map" value="false"/>
    <param name="listen-ip" value="127.0.0.1"/>
    <param name="listen-port" value="8021"/>
    <param name="password" value="ClueCon"/>
    <param name="apply-inbound-acl" value="loopback.auto"/>
  </settings>
</configuration>
EOF
chown freeswitch:freeswitch "$ESL_CONF" || true

# === step 4: enable + start ===
log "enabling + starting freeswitch.service"
systemctl daemon-reload
systemctl enable freeswitch
systemctl restart freeswitch

# === step 5: smoke test ===
sleep 3
if systemctl is-active --quiet freeswitch; then
  log "freeswitch is running"
  fs_cli -x 'status' 2>/dev/null | head -5 || log "(fs_cli not yet ready, ESL should still respond)"
else
  fail "freeswitch failed to start; check journalctl -u freeswitch"
fi

log "install complete"
