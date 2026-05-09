#!/usr/bin/env bash
# DialerOS — fresh Ubuntu 24.04 bootstrap
#
# Run as root from the repo root after a clean `git clone`:
#
#   git clone https://github.com/steven-patrick18/dialeros.git /opt/dialeros
#   cd /opt/dialeros
#   bash scripts/bootstrap.sh
#
# The script is idempotent — re-running it on an already-bootstrapped box
# upgrades dependencies and re-runs `pnpm install` but does not destroy
# data/.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIALEROS_USER="dialeros"
DIALEROS_GROUP="dialeros"
NODE_MAJOR="${NODE_MAJOR:-22}"

log()   { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '   \033[1;32mok\033[0m %s\n' "$*"; }
warn()  { printf '   \033[1;33mwarn\033[0m %s\n' "$*" >&2; }
die()   { printf '   \033[1;31merror\033[0m %s\n' "$*" >&2; exit 1; }

# -----------------------------------------------------------------------------
# preflight
# -----------------------------------------------------------------------------

if [[ "$(id -u)" -ne 0 ]]; then
  die "must run as root (try: sudo bash scripts/bootstrap.sh)"
fi

if ! grep -q 'Ubuntu' /etc/os-release; then
  warn "this script targets Ubuntu — proceed at your own risk"
fi

UBUNTU_VERSION="$(lsb_release -rs 2>/dev/null || echo unknown)"
log "DialerOS bootstrap on Ubuntu ${UBUNTU_VERSION} (repo: ${REPO_ROOT})"

# -----------------------------------------------------------------------------
# apt packages
# -----------------------------------------------------------------------------

log "Updating apt + installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg lsb-release \
  build-essential pkg-config \
  ufw fail2ban chrony \
  git rsync \
  ansible \
  nginx \
  >/dev/null
ok "base packages installed"

# -----------------------------------------------------------------------------
# Node.js (NodeSource repo)
# -----------------------------------------------------------------------------

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v${NODE_MAJOR}* && "$(node -v)" != v$((NODE_MAJOR+1))* && "$(node -v)" != v$((NODE_MAJOR+2))* ]]; then
  log "Installing Node.js ${NODE_MAJOR}.x from NodeSource"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod 644 /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y --no-install-recommends nodejs >/dev/null
fi
ok "node $(node -v)"

# -----------------------------------------------------------------------------
# pnpm (via npm — no corepack admin issues)
# -----------------------------------------------------------------------------

if ! command -v pnpm >/dev/null 2>&1; then
  log "Installing pnpm globally via npm"
  npm install -g pnpm@10 >/dev/null
fi
ok "pnpm $(pnpm -v)"

# -----------------------------------------------------------------------------
# dialeros system user
# -----------------------------------------------------------------------------

if ! getent group "${DIALEROS_GROUP}" >/dev/null; then
  log "Creating group ${DIALEROS_GROUP}"
  groupadd --system "${DIALEROS_GROUP}"
fi

if ! id "${DIALEROS_USER}" >/dev/null 2>&1; then
  log "Creating user ${DIALEROS_USER}"
  useradd --system --gid "${DIALEROS_GROUP}" \
    --home-dir /var/lib/dialeros --create-home \
    --shell /usr/sbin/nologin "${DIALEROS_USER}"
fi
ok "user ${DIALEROS_USER} present"

# -----------------------------------------------------------------------------
# repo ownership + data dir
# -----------------------------------------------------------------------------

DATA_DIR="${REPO_ROOT}/apps/admin-gui/data"
log "Setting up data dir ${DATA_DIR}"
install -d -m 0700 -o "${DIALEROS_USER}" -g "${DIALEROS_GROUP}" "${DATA_DIR}"
ok "data dir secured (0700, owned by ${DIALEROS_USER})"

log "Setting repo ownership to ${DIALEROS_USER}"
chown -R "${DIALEROS_USER}:${DIALEROS_GROUP}" "${REPO_ROOT}"
ok "ownership applied"

# -----------------------------------------------------------------------------
# pnpm install + build (as the dialeros user)
# -----------------------------------------------------------------------------

log "Installing JS dependencies (this will take a minute)"
sudo -u "${DIALEROS_USER}" -H bash -c "cd '${REPO_ROOT}' && pnpm install --frozen-lockfile" >/dev/null
ok "pnpm install complete"

log "Building admin-gui for production"
sudo -u "${DIALEROS_USER}" -H bash -c "cd '${REPO_ROOT}' && pnpm --filter @dialeros/admin-gui build" >/dev/null
ok "next build complete"

# -----------------------------------------------------------------------------
# systemd unit
# -----------------------------------------------------------------------------

log "Installing systemd unit"
install -m 0644 "${REPO_ROOT}/infra/systemd/dialeros-admin.service" /etc/systemd/system/
# Patch the unit's WorkingDirectory if the repo isn't at /opt/dialeros
if [[ "${REPO_ROOT}" != "/opt/dialeros" ]]; then
  sed -i "s|/opt/dialeros|${REPO_ROOT}|g" /etc/systemd/system/dialeros-admin.service
fi
systemctl daemon-reload
ok "systemd unit installed"

# -----------------------------------------------------------------------------
# done
# -----------------------------------------------------------------------------

cat <<EOF

  ─────────────────────────────────────────────────────────────────────
  bootstrap complete

  next steps:

    1. (optional) harden the box:
         bash ${REPO_ROOT}/infra/scripts/harden.sh

    2. start the admin GUI service:
         systemctl enable --now dialeros-admin
         systemctl status dialeros-admin

    3. (optional) put nginx in front of port 1111:
         cp ${REPO_ROOT}/infra/nginx/dialeros.conf /etc/nginx/sites-available/dialeros
         ln -sf /etc/nginx/sites-available/dialeros /etc/nginx/sites-enabled/dialeros
         rm -f /etc/nginx/sites-enabled/default
         nginx -t && systemctl reload nginx

    4. open your browser:
         http://<this-server-ip>:1111   (direct)
         http://<this-server-ip>          (via nginx, after step 3)

       you'll be redirected to /setup to create the first admin.
  ─────────────────────────────────────────────────────────────────────

EOF
