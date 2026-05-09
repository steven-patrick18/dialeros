# DialerOS — Proposed Monorepo Architecture

> **Status:** Proposal, not yet implemented. Review and adjust before scaffolding code.

The spec describes 5 logical node roles and a sprawling feature set. The repo layout below is one way to organize that. Approve, adjust, or discard.

## Top-level layout

```
dialeros/
├── SPEC.md                   # canonical spec
├── README.md
├── docs/
│   ├── REVIEW.md             # spec review (open questions, risks)
│   ├── ARCHITECTURE.md       # this file
│   ├── decisions/            # ADRs (architecture decision records)
│   └── runbooks/             # ops procedures (one per failure mode)
│
├── apps/                     # user-facing applications (Next.js)
│   ├── admin-gui/            # master node admin GUI — cluster mgmt, configs
│   ├── agent-ui/             # WebRTC browser agent — in-call screen
│   └── supervisor-cockpit/   # live floor view, monitoring, reporting
│
├── services/                 # backend services
│   ├── control-plane/        # master node orchestrator (Node or Go — TBD)
│   ├── api/                  # REST API + webhook delivery (Node)
│   ├── pacing-engine/        # outbound dialer pacing (Go for hot loop)
│   ├── whitelist-svc/        # inbound lead matching (Go, fast lookups)
│   ├── ai-worker/            # Python — AI agent runtime (Pipecat)
│   ├── ai-master/            # Python — RAG store + LoRA training pipeline
│   └── recording-svc/        # recording lifecycle, encryption, retrieval
│
├── packages/                 # shared libs (TypeScript-first)
│   ├── shared-types/         # types shared across apps + services (zod schemas)
│   ├── sip-client/           # WebRTC/SIP helpers for browser agents
│   ├── dkb-format/           # .dkb bundle reader/writer (TS + Python ports)
│   ├── webhook-sdk/          # client SDK for webhook subscribers
│   └── ui/                   # shared React components (shadcn-based)
│
├── telephony/                # SIP/media layer configs
│   ├── kamailio/             # cfg modules, dispatcher, routing
│   ├── freeswitch/           # dialplan, mod_verto, mod_recording
│   └── tests/                # SIPp scenarios for regression
│
├── infra/                    # provisioning + deployment
│   ├── ansible/              # cluster provisioning playbooks
│   │   ├── roles/master/
│   │   ├── roles/telephony/
│   │   ├── roles/web/
│   │   ├── roles/database/
│   │   └── roles/ai-worker/
│   ├── docker/               # docker-compose for local dev
│   ├── k8s/                  # optional Helm charts
│   └── terraform/            # cloud infra (optional)
│
├── db/                       # database layer
│   ├── migrations/           # PostgreSQL migrations (sqitch or similar)
│   ├── schema.sql            # current schema dump
│   └── seed/                 # dev fixtures
│
├── tools/                    # operator + developer tooling
│   ├── vicidial-migrate/     # ViciDial → DialerOS data migration
│   ├── load-gen/             # synthetic call generators (SIPp wrappers)
│   └── dkb-cli/              # inspect/sign/verify .dkb bundles
│
└── tests/                    # cross-component integration + e2e
    ├── e2e/                  # Playwright scenarios
    └── integration/          # multi-service tests
```

## Service boundaries

### control-plane (master node only)
- Manages cluster membership
- Pushes configs to all nodes
- Hosts admin GUI backend
- Runs the AI master agents (training, RAG store, LoRA pipeline coordinator)

### api (web nodes, stateless, multi-instance)
- REST API surface
- Webhook delivery worker
- WebSocket gateway for real-time events
- AuthN/AuthZ gate

### pacing-engine (web nodes, leader-elected)
- Predictive dialer math
- Per-agent ratio computation
- Capacity allocation across human + AI seats
- Hot loop — needs to make decisions every few hundred ms

### whitelist-svc (web nodes, stateless)
- Inbound caller → lead lookup
- Whitelist mode evaluation
- Hot path on every inbound call — must be <10ms p99

### ai-worker (AI worker nodes, multi-instance)
- One process per worker AI agent (or pool)
- Owns its FreeSWITCH SIP leg via Pipecat
- Reads RAG from master, loads LoRA from master
- Reports call outcomes back

### ai-master (master node, single instance)
- Owns RAG vector store
- Hosts knowledge base
- Coordinates nightly LoRA training jobs
- Signs and exports .dkb bundles

### recording-svc (web nodes, stateless workers)
- Receives recording finalization events from FreeSWITCH
- Encrypts at rest
- Indexes for retrieval
- Enforces retention + legal hold

## Data flow examples

### Outbound call (predictive)
```
pacing-engine → control-plane → telephony (Kamailio→FreeSWITCH)
                                       ↓
                                   carrier
                                       ↓
                                  caller answers
                                       ↓
                       FreeSWITCH bridges to seat (agent or AI)
                                       ↓
                          api emits call.connect webhook
```

### Inbound call (with whitelist)
```
carrier → telephony (Kamailio)
              ↓
         whitelist-svc lookup (lead match?)
              ↓
         in-group routing
              ↓
         FreeSWITCH bridges to selected agent
              ↓
         agent-ui screen pop with lead context
```

### AI call → human transfer
```
ai-worker on call → decides transfer
                          ↓
                    api → pacing-engine (find available human in target group)
                          ↓
                    FreeSWITCH bridges legs
                          ↓
                    ai-master ingests transcript for learning
```

## Decisions still to make

- **Control-plane language**: Node vs Go. Spec says "Node for control plane, Go where needed" — feels like premature multi-language overhead. Pick one for v1.
- **Hook runtime**: Spec says Lua + Python + JS for script hooks. That's three sandboxes to maintain. Likely pick Python only (already needed for AI infra).
- **Vector DB**: Qdrant (separate service) vs pgvector (lives in Postgres). Pgvector is operationally simpler at MVP scale, swap if bottlenecked.
- **Migration tool target**: Sqitch / Flyway / Prisma / Drizzle. Drizzle if we go full TypeScript.
- **Monorepo tool**: pnpm workspaces + Turborepo? Nx? Bazel? Probably pnpm + Turbo for the Phase 0 start.

See [REVIEW.md](REVIEW.md) for spec-level open questions that affect scoping.
