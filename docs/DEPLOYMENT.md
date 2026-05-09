# DialerOS — Deployment

End-to-end: from a fresh Ubuntu 24.04 box to a working DialerOS admin GUI.

## Prerequisites

- Ubuntu 24.04 LTS box with **public IP** and **root SSH access**
- Recommended: 4+ vCPU, 6+ GB RAM, 1 Gbps NIC, dedicated IPv4
  (RackNerd KVM-6GB, Hetzner CX22, DigitalOcean basic 6GB all work)

## Step 1 — SSH in

```bash
ssh root@<VPS_IP>
```

If you don't have your pubkey on the box yet, do that first:

```bash
# from your local machine:
ssh-copy-id root@<VPS_IP>
```

## Step 2 — Update + clone

```bash
apt update && apt upgrade -y
apt install -y git
mkdir -p /opt
cd /opt
git clone https://github.com/steven-patrick18/dialeros.git
cd dialeros
```

## Step 3 — Bootstrap

```bash
bash scripts/bootstrap.sh
```

This installs:
- Build essentials, ufw, fail2ban, chrony, nginx, ansible
- Node.js 22+ from NodeSource
- pnpm 10 globally
- Creates `dialeros` system user with restricted shell
- Sets up `data/` dir with mode 0700
- Runs `pnpm install --frozen-lockfile`
- Builds the admin-gui for production (`next build`)
- Installs the systemd unit

Takes 2-5 minutes depending on bandwidth.

## Step 4 — Harden the box

```bash
bash infra/scripts/harden.sh
```

Default behavior:
- UFW: deny all inbound, allow 22/80/443/1111 + SIP signaling/RTP
- fail2ban: 5 retries / 10m window / 1h ban for sshd
- SSH lockdown: disable password auth, key-only root login
- Unattended security upgrades enabled
- sysctl tweaks for SIP/RTP at scale

If you have NOT added your pubkey yet, the script auto-skips SSH lockdown
and warns you. Add your key, re-run with no args.

To skip SSH lockdown explicitly (e.g. for early dev):

```bash
bash infra/scripts/harden.sh --keep-ssh-open
```

## Step 5 — Start the service

```bash
systemctl enable --now dialeros-admin
systemctl status dialeros-admin
```

Logs:

```bash
journalctl -u dialeros-admin -f
```

## Step 6 — First admin

Browse to:

```
http://<VPS_IP>:1111
```

You'll be redirected to `/setup`. Create the first admin account.

After that, login at `/login` and you're in.

## Step 7 — (optional) nginx in front

Useful when you have a domain pointing here and want TLS via Let's Encrypt.

```bash
cp infra/nginx/dialeros.conf /etc/nginx/sites-available/dialeros
ln -sf /etc/nginx/sites-available/dialeros /etc/nginx/sites-enabled/dialeros
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Now visit `http://<VPS_IP>` (port 80) — nginx proxies to 1111.

For TLS:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

After TLS, edit `/etc/nginx/sites-available/dialeros` to set `server_name your-domain.com;` if you haven't already.

Once nginx is in front, you can close port 1111 in UFW:

```bash
ufw delete allow 1111/tcp
```

## Updates

The deploy story going forward:

```bash
# on the VPS:
cd /opt/dialeros
sudo -u dialeros git pull
sudo -u dialeros pnpm install --frozen-lockfile
sudo -u dialeros pnpm --filter @dialeros/admin-gui build
systemctl restart dialeros-admin
```

Or write a `deploy.sh` that does all of these. (Iter 8 candidate.)

## Backup

What to back up regularly:

| What | Where | Why |
|------|-------|-----|
| `apps/admin-gui/data/dialeros.db` | sqlite DB | Users, sessions, carriers, route plans, audit log |
| `apps/admin-gui/data/.master_key` | 32-byte key | **Critical** — without it, encrypted carrier passwords are lost |
| `/etc/nginx/sites-available/dialeros` | nginx conf | If you customized it |
| `/etc/letsencrypt/` | certs | If you enabled TLS |

A simple cron job:

```bash
# /etc/cron.d/dialeros-backup
0 3 * * * dialeros tar -czf /var/lib/dialeros/backup-$(date +\%Y\%m\%d).tar.gz -C /opt/dialeros/apps/admin-gui data
```

(Real backup story: ship those tarballs offsite. Phase 2+ moves data to PostgreSQL with proper streaming replication.)

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `systemctl status dialeros-admin` shows failure | `journalctl -u dialeros-admin -n 100` for the actual error |
| 502 from nginx | Service is down or wrong port. `curl localhost:1111/login` first. |
| Cannot connect to port 1111 from outside | UFW: `ufw status`. Should show `1111/tcp ALLOW`. |
| `pnpm install` fails | Check Node version: `node -v`. Need >= 22.5. |
| `next build` fails OOM | Add swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` |
| Setup form rejects username | Must be lowercase alphanumeric + dashes/underscores, 3-64 chars |
| First admin lost their password | No recovery path in iter 6. Direct sqlite edit (delete user, re-trigger /setup) for now. |

## Roles ahead (when you scale beyond all-in-one)

The current single-box setup hosts master + telephony + web + database in one process tree. When ready to split:

- **Database node** — move sqlite → PostgreSQL on a dedicated box
- **Telephony node** — Kamailio + FreeSWITCH on dedicated box (uses `1Gbps` NIC bandwidth budget)
- **AI worker node** — separate box per the spec (CPU-heavy or with GPU)
- **Web node** — multiple instances behind nginx for HA

Use the GUI's Add Node flow to register each. The Ansible runner (Phase 0 iter 7+) will provision them from a master playbook.
