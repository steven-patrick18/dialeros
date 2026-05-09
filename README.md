# DialerOS

A next-generation cloud dialer platform — ViciDial replacement with AI agents, hierarchical AI (master/worker), portable AI memory, and operator-grade visibility.

> **Status:** Phase 0, iteration 1 — admin GUI shell + Add Node flow with stubbed provisioner.
> Canonical spec: [SPEC.md](SPEC.md). Spec review: [docs/REVIEW.md](docs/REVIEW.md). What landed in iter 1: [docs/PHASE-0-NOTES.md](docs/PHASE-0-NOTES.md).

## Quick start

Prerequisites:

- Node.js 22+ (`.nvmrc` says 22)
- pnpm 10+ — run `corepack enable && corepack prepare pnpm@10 --activate`

From this directory:

```bash
pnpm install
pnpm dev
```

Open <http://localhost:1111>. Click **Cluster Nodes → + Add Node** and submit the form. Provisioning is a 5-second stub in iter 1 (no real SSH yet) — see [docs/PHASE-0-NOTES.md](docs/PHASE-0-NOTES.md).

## What this is

- Self-hosted, air-gap capable, no GPUs required
- WebRTC browser agents, no softphone install
- AI agents using local models (whisper.cpp, llama 1B-3B Q4, Piper TTS)
- Master/Worker AI architecture for shared learning at scale
- Portable AI memory via signed `.dkb` bundles
- Full ViciDial feature parity for call control + modern observability
- Targets: 2,000 concurrent calls / 200 agents on commodity hardware

## Repo layout

Layout in place (Phase 0 iter 1). Empty dirs are placeholders. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full plan.

```
dialeros/
├── SPEC.md                       canonical product spec
├── package.json                  monorepo root (pnpm + Turbo)
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── apps/
│   └── admin-gui/                Next.js admin GUI — port 1111
├── services/
│   └── control-plane/            @dialeros/control-plane (TS)
├── packages/                     (shared libs, when needed)
├── infra/
│   └── ansible/                  cluster provisioning
├── db/                           Postgres migrations (Phase 0 iter 2+)
└── docs/
    ├── REVIEW.md                 spec review — issues + decisions needed
    ├── ARCHITECTURE.md           proposed service boundaries
    └── PHASE-0-NOTES.md          iter 1 status, what's stubbed, what's next
```

## Build phases (from spec)

| Phase | Weeks | Scope |
|-------|-------|-------|
| 0 | 8 | Foundations — provisioning, auth, audit |
| 1 | 12 | Core telephony — Kamailio + FreeSWITCH + WebRTC |
| 2 | 8 | Campaigns, leads, pacing, dispositions |
| 3 | 8 | In-groups, IVR, soundboard (MVP complete) |
| 4 | 12 | AI agents v1 |
| 5 | 8 | Master/worker AI hierarchy |
| 6 | 6 | .dkb portability + ViciDial migration tools |
| 7 | 6 | Visual builders |
| 8 | 8 | Enterprise compliance |

**MVP at end of Phase 3** (~36 weeks). AI-enabled at Phase 5 (~56 weeks).

## Workflow

Local first → git → VPS. No remotes wired up yet.
