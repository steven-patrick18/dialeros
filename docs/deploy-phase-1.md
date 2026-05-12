# Phase 1 deployment checklist (iters 114–120)

Concrete steps to take a Phase 1 build live on a single-box VPS.
Assumes the existing iter-7 bootstrap layout (`/opt/dialeros` repo
checkout, admin-gui running via systemd, FreeSWITCH already
installed from iter 96-era infra).

Hard verification points are called out per step — these are the
spots that need real-box smoke testing because they couldn't be
exercised on a dev laptop.

---

## 1 · Pull + install

```bash
ssh root@<vps>
cd /opt/dialeros
git fetch origin
git checkout main
git pull --ff-only
pnpm install --frozen-lockfile
pnpm --filter @dialeros/admin-gui build
systemctl restart dialeros-admin
```

Verify the new release is up:

```bash
curl -fsS http://127.0.0.1:3000/api/health | jq .status
# expected: "healthy" or "degraded" (NOT "down")
```

---

## 2 · Environment variables

Drop in `/etc/dialeros/admin.env` (or whatever path the systemd
unit's `EnvironmentFile=` points at) and `systemctl restart
dialeros-admin` after editing:

```bash
# Shared secret between Kamailio + FS xml_curl + admin-gui's
# /api/internal/* endpoints. Generate with `openssl rand -hex 32`.
# When unset the endpoints accept unauthenticated requests but log
# a warning — fine for first-time bring-up, NOT for production.
KAMAILIO_INBOUND_TOKEN=<32-byte hex token>

# Where FS lives for internal-side bridge targets. Defaults
# already work on a single-box deploy; override only for split
# admin / telephony nodes.
DIALEROS_FS_INTERNAL_HOST=127.0.0.1
DIALEROS_FS_INTERNAL_PORT=5080

# Where admin-gui listens. FS xml_curl + Kamailio both POST to
# this URL; defaults to localhost.
DIALEROS_ADMIN_URL=http://127.0.0.1:3000
```

---

## 3 · Kamailio (iter 114 + iter 117)

```bash
sudo /opt/dialeros/scripts/install-kamailio.sh
```

This installs Kamailio 5.8 LTS from the upstream repo, drops
`/etc/kamailio/kamailio.cfg` from `infra/kamailio/`, opens UDP+TCP
5060 on ufw, and enables (but does NOT start) the service.

Before starting, populate the trusted-source list:

```bash
sudo -e /etc/kamailio/trusted.list
# Add one line per PSTN trunk source IP, with proto:
#   1.2.3.4 udp
#   5.6.7.8 tcp
```

Surface the token to Kamailio via `/etc/default/kamailio` (the
file `kamailio.service` reads on startup):

```bash
sudo tee -a /etc/default/kamailio >/dev/null <<EOF
DIALEROS_INBOUND_TOKEN=<same value as KAMAILIO_INBOUND_TOKEN above>
EOF
```

Start Kamailio + tail for the first inbound call:

```bash
sudo systemctl start kamailio
sudo systemctl enable kamailio
journalctl -fu kamailio
```

**Verify (real-box smoke tests):**
- Place a call from one of the trusted carrier source IPs to a
  DID that's mapped to an in-group. Watch the journal for
  `[<call-id>] route decision: action=forward target=sip:...`.
- Place a call to a DID that **isn't** mapped — expect
  `action=reject reason=unmapped_did` and a 404 back to the
  carrier.
- Spoof a call from an **un-trusted** source IP — expect the
  `untrusted source X.X.X.X:5060 drop` line and a 403.

---

## 4 · FreeSWITCH dialplan + Lua (iter 116 + iter 119 + iter 120)

Copy iter-116/120 dialplan + Lua files into FS's configured
locations (default Debian package path):

```bash
sudo cp /opt/dialeros/infra/freeswitch/dialplan/dialeros_inbound_queue.xml \
        /etc/freeswitch/dialplan/default/

sudo mkdir -p /usr/share/freeswitch/scripts
sudo cp /opt/dialeros/infra/freeswitch/lua/dialeros_queue_poll.lua \
        /usr/share/freeswitch/scripts/

sudo cp /opt/dialeros/infra/freeswitch/autoload_configs/xml_curl.conf.xml \
        /etc/freeswitch/autoload_configs/

# Replace CHANGE_ME_TOKEN in xml_curl.conf.xml with the same token
sudo sed -i "s|CHANGE_ME_TOKEN|$KAMAILIO_INBOUND_TOKEN|" \
        /etc/freeswitch/autoload_configs/xml_curl.conf.xml
```

Load required modules in `/etc/freeswitch/autoload_configs/modules.conf.xml`
(uncomment or add the `<load module="..."/>` lines):
- `mod_xml_curl`     — iter 119 directory lookups
- `mod_lua`          — iter 116 queue-poll loop
- `mod_curl`         — iter 116 Lua HTTP calls
- `mod_conference`   — iter 120 3-way
- `mod_local_stream` — iter 116 MOH source (or substitute mod_playback)

Reload FS:

```bash
sudo fs_cli -x 'reloadxml'
sudo fs_cli -x 'reload mod_xml_curl'
sudo fs_cli -x 'load mod_conference'
sudo fs_cli -x 'load mod_lua'
sudo fs_cli -x 'load mod_curl'
```

**Verify (real-box smoke tests):**
- **iter 119 — directory**: provision a phone via `/users/<id>/phones`
  in the admin UI. Register a hard phone (or `pjsua` / `Linphone`)
  with that extension + password to `<vps-ip>:5060`. Expect
  successful REGISTER. Watch FS for `[mod_xml_curl] HTTP request:
  ... POST /api/internal/fs-directory` and a 200 with the directory
  XML.
- **iter 116 — queue**: simulate "no agent available" by pausing all
  agents in an in-group, then call its DID. Expect: Kamailio
  forwards to `dialeros-inbound-queue`, FS answers + plays MOH,
  the `inbound_queue` row appears on `/supervisor → Parked callers`
  with a live hold timer. Unpause an agent; expect the FS Lua
  loop's next poll to return `action=forward` and the call to
  bridge.
- **iter 120 — 3-way**: place an outbound, click Xfer in the
  softphone, pick **Attended** + dial an internal extension,
  answer on the second device, click **Add to call (3-way)**.
  Expect all three legs audible. The `audit_events` table gets
  one `agent.transfer_conferenced` entry with the room name.

---

## 5 · Backup automation (iter 112)

```bash
sudo install -m 0755 /opt/dialeros/scripts/backup-nightly.sh \
        /opt/dialeros/scripts/
sudo install -m 0644 /opt/dialeros/infra/systemd/dialeros-backup.service \
        /etc/systemd/system/
sudo install -m 0644 /opt/dialeros/infra/systemd/dialeros-backup.timer \
        /etc/systemd/system/

sudo mkdir -p /var/backups/dialeros
sudo chown dialeros:dialeros /var/backups/dialeros

# Optional offsite mirror — drop this if you want local-only:
sudo tee /etc/dialeros/backup.env >/dev/null <<EOF
REMOTE_RSYNC_TARGET=backups@<offsite>:/srv/dialeros-backups
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now dialeros-backup.timer
```

**Verify:**
- `systemctl status dialeros-backup.timer` shows next fire at next
  02:00 local.
- `sudo /opt/dialeros/scripts/backup-nightly.sh` runs cleanly on
  demand. A new dir under `/var/backups/dialeros/<timestamp>/`
  contains `dialeros.db` (and `recordings/` if any exist).

---

## 6 · End-to-end smoke matrix

After 1–5, run through this list. Each row is a 2-minute test.

| # | Test | Expected |
|---|------|----------|
| 1 | Browser softphone REGISTER | green REG light on `/agent` |
| 2 | Hard phone REGISTER (iter 119) | phone shows registered, FS shows the contact via `sofia status profile internal reg` |
| 3 | Outbound manual dial from softphone | call rings out, `dial_intents` row inserted, `/realtime` shows it |
| 4 | Outbound pacer dial (campaign with leads + carrier configured) | `/campaigns/<id>` shows active originates, dial-level cap math is right |
| 5 | Inbound PSTN to mapped DID, agent available | call lands on agent, `/supervisor → Inbound monitor` shows `forwarded` |
| 6 | Inbound PSTN, all agents paused | call lands in queue, `/supervisor → Parked callers` shows hold timer; unpause → call bridges |
| 7 | Attended transfer (iter 118): consult → complete | customer hears MOH during consult, agent drops on complete |
| 8 | Attended transfer (iter 118): consult → cancel | customer comes off hold, agent returns to original call |
| 9 | 3-way conference (iter 120) | all three legs audible in xfer-... room |
| 10 | `/api/health` | 200, status=healthy |

Any failure here is a deployment-blocker. The audit log
(`/audit`) captures every transfer + inbound decision so
post-mortems are straightforward.
