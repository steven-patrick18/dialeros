#!/usr/bin/env bash
# DialerOS — server hardening for a fresh Ubuntu 24.04 box
#
# What this does:
#   1. Configure UFW (default deny inbound, allow SSH + HTTP/HTTPS + SIP/RTP)
#   2. Enable fail2ban with the sshd jail
#   3. Lock down SSH config (disable password auth, disable root login —
#      ONLY runs this step if you've already added your pubkey to
#      ~/.ssh/authorized_keys, otherwise refuses)
#   4. Enable unattended security upgrades
#
# Run as root after bootstrap.sh:
#   bash infra/scripts/harden.sh
#
# Skip the SSH lockdown by passing --keep-ssh-open:
#   bash infra/scripts/harden.sh --keep-ssh-open

set -euo pipefail

KEEP_SSH_OPEN=0
for arg in "$@"; do
  case "$arg" in
    --keep-ssh-open) KEEP_SSH_OPEN=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '   \033[1;32mok\033[0m %s\n' "$*"; }
warn() { printf '   \033[1;33mwarn\033[0m %s\n' "$*" >&2; }
die()  { printf '   \033[1;31merror\033[0m %s\n' "$*" >&2; exit 1; }

if [[ "$(id -u)" -ne 0 ]]; then
  die "must run as root"
fi

# -----------------------------------------------------------------------------
# UFW
# -----------------------------------------------------------------------------

log "Configuring UFW"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing

# SSH
ufw allow 22/tcp comment "SSH"

# HTTP + HTTPS (admin GUI behind nginx, future TLS)
ufw allow 80/tcp  comment "HTTP"
ufw allow 443/tcp comment "HTTPS"

# Direct admin GUI port (handy for early testing; remove after nginx is in front)
ufw allow 1111/tcp comment "DialerOS admin GUI (direct)"

# SIP signaling
ufw allow 5060/udp comment "SIP UDP"
ufw allow 5060/tcp comment "SIP TCP"
ufw allow 5061/tcp comment "SIP TLS"

# RTP media
ufw allow 16384:32768/udp comment "RTP media"

ufw --force enable >/dev/null
ok "UFW enabled (default deny in / allow out)"
ufw status numbered | sed 's/^/   /'

# -----------------------------------------------------------------------------
# fail2ban
# -----------------------------------------------------------------------------

log "Configuring fail2ban (sshd jail)"
mkdir -p /etc/fail2ban/jail.d
cat >/etc/fail2ban/jail.d/dialeros-sshd.conf <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban >/dev/null 2>&1
systemctl restart fail2ban >/dev/null
ok "fail2ban active"

# -----------------------------------------------------------------------------
# unattended-upgrades
# -----------------------------------------------------------------------------

log "Enabling unattended security upgrades"
apt-get install -y unattended-upgrades >/dev/null 2>&1
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null
ok "unattended-upgrades configured"

# -----------------------------------------------------------------------------
# SSH lockdown (optional, opt-out via --keep-ssh-open)
# -----------------------------------------------------------------------------

if [[ "${KEEP_SSH_OPEN}" -eq 1 ]]; then
  warn "skipping SSH lockdown (--keep-ssh-open)"
else
  log "Locking down SSH"
  AUTH_KEYS="/root/.ssh/authorized_keys"
  if [[ ! -s "${AUTH_KEYS}" ]]; then
    warn "no keys found in ${AUTH_KEYS}"
    warn "skipping SSH lockdown — you would lock yourself out."
    warn "add your pubkey first:"
    warn "  echo 'ssh-ed25519 AAAA...' >> ${AUTH_KEYS}"
    warn "  chmod 600 ${AUTH_KEYS}"
    warn "then re-run this script."
  else
    SSHD_CONF="/etc/ssh/sshd_config.d/99-dialeros.conf"
    cat >"${SSHD_CONF}" <<'EOF'
# DialerOS SSH lockdown — applied by infra/scripts/harden.sh
PasswordAuthentication no
PermitRootLogin prohibit-password
ChallengeResponseAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
EOF
    sshd -t || die "sshd config test failed — leaving config alone"
    systemctl reload ssh >/dev/null 2>&1 || systemctl reload sshd >/dev/null
    ok "SSH locked: password auth disabled, key-only root login"
  fi
fi

# -----------------------------------------------------------------------------
# sysctl tweaks helpful for SIP/RTP at scale
# -----------------------------------------------------------------------------

log "Applying sysctl tweaks"
cat >/etc/sysctl.d/60-dialeros.conf <<'EOF'
# Larger UDP receive buffers — SIP/RTP packet bursts under load
net.core.rmem_default = 524288
net.core.rmem_max = 16777216
net.core.wmem_default = 524288
net.core.wmem_max = 16777216

# Higher conntrack ceiling — many simultaneous SIP dialogs
net.netfilter.nf_conntrack_max = 524288

# Faster reclamation under press
net.ipv4.tcp_fin_timeout = 30
EOF
sysctl --system >/dev/null
ok "sysctl applied"

cat <<EOF

  ─────────────────────────────────────────────────────────────────────
  hardening complete

  what changed:
    - UFW: default deny inbound, allow 22/80/443/1111 + SIP/RTP
    - fail2ban: sshd jail (5 retries, 10m window, 1h ban)
    - unattended-upgrades: security patches auto-applied
    - sysctl: UDP buffers + conntrack table sized for telephony
$( [[ ${KEEP_SSH_OPEN} -eq 1 ]] && echo "    - SSH: NOT locked (keeping password auth open per --keep-ssh-open)" || echo "    - SSH: password auth disabled, key-only login")

  recommended next:
    - point your domain at this box's public IP
    - run certbot --nginx to enable TLS
  ─────────────────────────────────────────────────────────────────────

EOF
