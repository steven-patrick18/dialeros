# Ansible — DialerOS Node Provisioning

Phase 0 status: **structure in place, role tasks are stubs except `common`**.

## Layout

```
infra/ansible/
├── ansible.cfg              # global Ansible config
├── inventory/               # per-run inventory (gitignored content)
├── playbooks/
│   └── provision-node.yml   # entry point — called by control-plane
└── roles/
    ├── common/              # base hardening + tools (every node)
    ├── telephony/           # Kamailio + FreeSWITCH (Phase 1 — stub)
    ├── web/                 # admin GUI + API (Phase 0 iter 2 — stub)
    ├── database/            # PostgreSQL primary (Phase 0 iter 2 — stub)
    └── ai-worker/           # whisper + llama + Piper (Phase 4 — stub)
```

## Manual run (for testing the playbook directly)

```bash
ansible-playbook -i 'HOST,' \
  -u root \
  --extra-vars "role=web node_name=web-01" \
  --ssh-extra-args="-o StrictHostKeyChecking=no" \
  playbooks/provision-node.yml
```

You will need `sshpass` installed on the master to pass passwords on first
run. Once the node has the master's pubkey, key-based auth replaces the
password.

## Triggered by control-plane

In Phase 0 iter 2, the control-plane process spawns `ansible-playbook` as a
child process when a user submits the Add Node form. stdout is streamed back
to the GUI via Server-Sent Events. See `services/control-plane/src/provisioner.ts`.

## What's NOT done yet (iter 1 → iter 2)

| Concern | Status |
|---------|--------|
| `common` role: hostname, packages, dialeros user, ufw | ✅ written |
| `common` role: SSH key rotation, root SSH disable | ❌ TODO |
| `web` role: Node.js + nginx + app deploy | ❌ stub |
| `database` role: PostgreSQL install + schema | ❌ stub |
| `telephony` role: Kamailio + FreeSWITCH | ❌ stub (Phase 1) |
| `ai-worker` role: Pipecat toolchain | ❌ stub (Phase 4) |
| Idempotent re-runs against existing nodes | ⚠️ unverified |
| Vault-based secret handling | ❌ env vars for now |
| Health check after provisioning | ❌ TODO |
