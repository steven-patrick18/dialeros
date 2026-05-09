# Phase 0 + Phase 1 entry — Status

## Iter 6 (current) — Theme system + Edit carrier

### Theme

- **CSS variable token system** (`globals.css`) with two themes: light (white + ViciDial blue) and dark (current zinc neutrals + brighter blue). Tokens: `bg`, `card`, `card-hover`, `border`, `fg`, `fg-muted`, `fg-subtle`, `accent`, `accent-hover`, `accent-fg`, `success`, `warn`, `error`. Tokens are RGB triplets so Tailwind alpha modifiers (`bg-accent/15`) work.
- **Tailwind extends** with these tokens (`tailwind.config.ts`); existing classes like `bg-accent`, `text-fg-muted`, `border-border` flip automatically with the theme.
- **`darkMode: 'class'`** — the `dark` class on `<html>` toggles all variables.
- **SSR theme detection** — `lib/theme.ts` reads `dialeros_theme` cookie in the root layout and renders the class server-side (no FOUC).
- **Theme toggle** in the sidebar (`components/theme-toggle.tsx`). Persists to cookie + localStorage. Click flips `<html>` class instantly.
- **Default = light** per user request (matches ViciDial's white-with-blue look).
- **20 page files migrated** via PowerShell sed-style replacement. Status badges, error banners, accent buttons, panel backgrounds — all use semantic tokens now.

Verified:
```
GET /login (no cookie)           → <html class="">      (light)
GET /login (theme=dark cookie)   → <html class="dark">  (dark)
```

### Edit carrier

- **`CarrierUpdateInputSchema`** — every field optional. `digest_password` empty/absent means "keep existing encrypted value" (don't re-encrypt, don't clear).
- **`updateCarrier()`** — builds a partial UPDATE statement. Re-encrypts password only when a new one is provided.
- **`PUT /api/carriers/[id]`** — admin-only, audited. Audit payload excludes raw password (sets `digest_password_changed: true` if the password was rotated, otherwise omits it).
- **`/carriers/[id]/edit`** — server-component page that hydrates a client edit form with current values. Password field placeholder shows `●●●●●●●● (unchanged)` when one exists.
- **Edit button** added to `/carriers/[id]` detail page next to the existing Delete.

Verified end-to-end:
```
PUT max_channels: 2000 → 200    → 200, audit captured {"max_channels":200}
Password envelope unchanged      → confirmed (no digest_password in payload)
PUT max_channels: 99999          → 400 "Number must be less than or equal to 10000"
```

The user's `Mueen_Vendor` carrier now has `max_channels: 200` (down from the unrealistic 2000 they originally entered).

## Iter 5 — Route Plans

The bridge between carriers and (Phase 2) campaigns. A route plan bundles a primary carrier, optional ordered failovers, caller-ID strategy, and number transformations.

What landed:

- **`route_plans` table** — name, description, primary_carrier_id (FK), failover_carrier_ids_json (ordered list), cid_strategy + cid_single + cid_pool_json, transform_strip_prefix + transform_add_prefix, enabled.
- **`RoutePlanInputSchema`** with three cross-field refinements: cid_strategy=single requires cid_single (validated as phone number); cid_strategy=rotate requires non-empty pool of valid numbers; primary cannot also be a failover.
- **API routes**: `POST /api/route-plans` (admin-only, audited), `GET /api/route-plans`, `GET /api/route-plans/[id]`, `DELETE /api/route-plans/[id]`.
- **Carrier-in-use guard** — `DELETE /api/carriers/[id]` now returns 409 with the names of referencing route plans when applicable. Verified by trying to delete `Mueen_Vendor` while a route plan referenced it: blocked with "Carrier is referenced by 1 route plan: sales-usa-test. Delete those first."
- **GUI pages**: list (with carrier-name resolution + empty state that prompts to add a carrier first if none exist), Add form (5 sections including Caller ID with conditional fields per strategy, Number Transformation), detail page with example transform applied (`+14155551234` → `14155551234` with strip-+ + add-1), inline delete confirmation.
- **Carrier detail page now shows** "Used by route plans (N)" with role per plan (primary or failover) and a note that deletion is blocked.
- **Dashboard** restructured: 4 tiles → Nodes ready / Carriers enabled / Route plans / Active calls.

Verified end-to-end:
```
POST /api/route-plans       → 201 (rotate, pool=3, transform +→1)
POST invalid cid_pool       → 400 "cid_pool must contain at least one valid phone number"
POST primary == failover    → 400 "primary carrier cannot also be a failover"
DELETE carrier while in use → 409 "referenced by 1 route plan: sales-usa-test"
DELETE route plan            → 200
```

Audit log captured `route_plan.created` and `route_plan.deleted` with actor.

## Iter 4 — Phase 1 entry: Carrier Management

First Phase 1 surface. Add a SIP carrier (digest or IP-ACL auth), see it in the list, view detail, delete with confirmation. Digest passwords are encrypted at rest with AES-256-GCM.

What landed:

- **Envelope encryption** (`secrets.ts`) — AES-256-GCM with a 32-byte master key auto-generated on first run at `data/.master_key` (chmod 600 on POSIX, gitignored). Format: `v1:iv:ciphertext:authtag`. Tampering produces an auth-tag mismatch on decrypt.
- **Carriers table** with 16 columns: connection (host/port/transport), auth (mode + username + encrypted password OR ip_acl), codecs (JSON-encoded preference order), capacity (max_channels, max_cps), quality (mos_threshold), enabled flag.
- **CarrierInputSchema** with cross-field refinements: digest auth requires username+password; ip-acl auth requires ip_acl.
- **API routes**: `POST /api/carriers` (admin-only, audited), `GET /api/carriers`, `GET /api/carriers/[id]` (returns `has_digest_password: bool` instead of the encrypted blob — password never leaves the DB), `DELETE /api/carriers/[id]` (admin-only, audited).
- **GUI pages**: list with empty state, multi-section Add Carrier form (Identity / Connection / Authentication / Codecs / Capacity & Quality), detail page with masked password, inline delete confirmation.
- **Dashboard**: 4th tile shows `Carriers enabled / total`.

Verified end-to-end via auth-injected fetch test:
- POST creates carrier, returns 201 with new UUID.
- Validation rejects missing digest_password with descriptive 400.
- GET list returns it; GET detail returns `has_digest_password: true` and never the encrypted blob.
- Plaintext password "super-secret-pw-XYZ" does **not** appear anywhere in the encrypted envelope (sqlite-side string search confirms).
- DELETE 200, follow-up GET 404.
- Audit events: `carrier.created` then `carrier.deleted`, both with actor.

## Iter 3 — Auth + Audit Log

Auth + audit log foundation. Required before any non-localhost binding, and a SOC2/HIPAA prereq from spec §14. All on Windows-friendly Node primitives — no native deps added.

What landed:

- **Setup flow** — first request hits `/setup` (route group redirects when `userCount() === 0`); creates the first admin and auto-logs in.
- **Login + sessions** — `scryptSync` password hashing (Node built-in, no bcrypt native dep), server-side session table, signed cookie (HttpOnly, SameSite=Lax, 7-day TTL).
- **Auth gate** — pages live under `app/(authed)/` route group with a layout that redirects unauth requests to `/login`. API routes do their own `getCurrentUser()` check; admin-only routes also check `role === 'admin'`.
- **Audit log** — new `audit_events` table with **DB-level append-only triggers** (UPDATE and DELETE on the table raise). Captures user.created, user.login_success, user.login_failure, user.logout, node.created, node.status_changed. Each event records actor user, IP, target, and JSON payload.
- **Audit page** at `/audit` — most-recent-200 timeline with action labels, color-coded high-signal actions (failed logins red), pre-resolved actor usernames, structured payload display.
- **Provisioner takes actor context** — `provisionNode(input, { actorUserId, actorIp })`. Status changes attribute to the user who triggered them.
- **Logout** — destroys server-side session (not just cookie), audited.

Verified end-to-end via curl: setup→cookie→authed POST→logout→401, plus audit table contains 6+ events including failed-login, plus DB triggers reject UPDATE/DELETE.

## Iter 2

Real provisioning pipeline + live progress UI. The Ansible runner is **mocked** because the dev host is Windows (Ansible doesn't run native), but the architecture, SSE plumbing, log persistence, and UI are all real.

What landed:

- **Runner abstraction** (`services/control-plane/src/runner/`) — `AnsibleRunner` interface; `MockAnsibleRunner` emits realistic phased output. `getRunner()` factory will detect real `ansible-playbook` (or `wsl ansible-playbook`) in iter 3.
- **Event bus** (`services/control-plane/src/event-bus.ts`) — in-process `EventEmitter` with `globalThis` cache so HMR doesn't lose subscribers. Will swap to Redis Streams when control-plane splits out.
- **Log persistence** — new `provisioning_logs` sqlite table with `(node_id, id)` index. Logs survive page refresh.
- **SSE endpoint** — `GET /api/nodes/[id]/events` replays history, then streams live events with 15s heartbeat. Cleanup on `req.signal` abort.
- **Live log panel** (`components/provision-log.tsx`) — auto-scrolling terminal-style view, color-coded by level, status indicator, "reconnecting…" hint when SSE drops.
- **Failure path test hook** — node names containing "fail" deterministically trigger a FAILED outcome midway, so the error UI is exercisable without code edits.

Verified end-to-end via curl: 17 log entries on a healthy provision, 12 entries + correct error message on a failed one.

## Iter 1

Initial scaffold: monorepo, admin GUI on port 1111, Add Node form, sqlite, stub provisioner. See git history.

## Run it locally

Prerequisites:

- Node.js 22.5+ (`.nvmrc` says 22; tested on 24)
- pnpm 10+ — install via `npm i -g pnpm@10` (corepack route fails without admin on Windows)

From this directory:

```bash
pnpm install
pnpm dev
```

Open <http://localhost:1111>. Click **Cluster Nodes → + Add Node**:

- Any name → success path (~5s, ~17 phases)
- Name containing `fail` → fail path (~3s, halt with error)

The node detail page shows the live log stream.

## What's stubbed (still)

| Concern | Iter 2 (now) | Iter 3 plan |
|---------|--------------|-------------|
| Ansible execution | mock runner emits phased output | `RealAnsibleRunner` spawning `ansible-playbook` (or `wsl ansible-playbook`); env override `DIALEROS_RUNNER=mock\|real` |
| SSH password handling | discarded immediately (mock has nothing to auth) | `sshpass` on first connect; install master pubkey; rotate to key auth; erase password from process memory |
| DB | sqlite, single-process | PostgreSQL with migrations (drizzle-kit) |
| Auth | none — localhost only | session-based + RBAC |
| Audit log | none | append-only `audit_events` table |
| Multi-tenancy | none | `tenant_id` everywhere + row-level security |
| Re-provision / decommission flows | unsupported | + confirmation flow + de-provisioning playbook |
| Health checks post-provision | none | per-role health probe before status → READY |

## Architecture decisions made

- **Monorepo:** pnpm workspaces + Turborepo
- **Frontend:** Next.js 15 App Router, React 19, Tailwind 3
- **Control plane:** TypeScript package `@dialeros/control-plane`, imported by Next.js. Will be promoted to a separate Node service in iter 3+ when the agent UI / supervisor cockpit also need it.
- **Local DB:** Node 24's built-in `node:sqlite` (DatabaseSync). Zero deps, no native compile. Hot-swap to Postgres before Phase 2.
- **Provisioning runtime:** Ansible (mocked for now). Control-plane runner abstraction means the swap is one file.
- **Event bus:** in-process EventEmitter for SSE. Swap to Redis Streams when control-plane splits.
- **Port convention:** admin-gui dev on **1111**. Control-plane (when split) on 1112.
- **No `better-sqlite3`** — Visual Studio Build Tools dependency is too painful on Windows dev hosts. `node:sqlite` is the right call going forward.

## Decisions deferred

- Whether to keep control-plane in TS or rewrite hot-path services (pacing-engine, whitelist-svc) in Go. Defer until profiling proves it.
- Hook script language(s). Defer to Phase 4 (REVIEW.md item #5).
- Production secret handling (Vault? sealed secrets?). Iter 3 will use env vars; revisit before any non-localhost deployment.
- Monorepo lint/format setup (eslint flat? biome?). Defer until first PR review pain.

## Known limitations / debt

- **Windows dev host:** master is intended to run on Linux. iter 3 needs WSL detection or a `RealAnsibleRunner` that errors clearly on Windows without WSL.
- **No CSRF** on the API. Acceptable for localhost-only dev; required before any non-localhost binding.
- **`@dialeros/control-plane` exports source TS directly** (no build step). Next.js handles via `transpilePackages`. If a non-Next.js consumer arrives, add a `tsup` build step.
- **iter 1 nodes have no logs** — they were created before `provisioning_logs` existed. Detail page just shows "Waiting for events…" with terminal status. No backfill needed.
- **Event bus is per-process** — multi-process master needs Redis/NATS swap.
- **SSE through dev proxy** — `X-Accel-Buffering: no` is set, but if you put nginx in front, configure it to not buffer text/event-stream.

## File map (current)

```
D:/dialeros/
├── package.json                              monorepo root, pnpm@10.33.4
├── pnpm-workspace.yaml, turbo.json, tsconfig.base.json
├── apps/admin-gui/                           Next.js on port 1111
│   ├── app/
│   │   ├── page.tsx                          dashboard with stat tiles
│   │   ├── api/nodes/route.ts                POST/GET /api/nodes
│   │   ├── api/nodes/[id]/route.ts           GET node + persisted logs
│   │   ├── api/nodes/[id]/events/route.ts    SSE stream of provisioning events
│   │   └── cluster/nodes/
│   │       ├── page.tsx                      list w/ empty state
│   │       ├── add/page.tsx                  Add Node form
│   │       └── [id]/page.tsx                 detail + ProvisionLog
│   └── components/
│       ├── nav.tsx
│       └── provision-log.tsx                 live SSE log panel
├── services/control-plane/
│   └── src/
│       ├── schema.ts                         zod input + types
│       ├── db.ts                             node:sqlite, nodes + logs
│       ├── event-bus.ts                      EventEmitter for streaming
│       ├── runner/
│       │   ├── types.ts                      AnsibleRunner interface
│       │   ├── mock.ts                       MockAnsibleRunner
│       │   └── index.ts                      getRunner() factory
│       ├── provisioner.ts                    orchestrates runner + emit
│       └── index.ts                          public surface
└── infra/ansible/                            (unchanged from iter 1)
```
