# DialerOS — Complete Product Specification

A next-generation cloud dialer platform — ViciDial replacement with AI agents, operator-grade features, hierarchical AI, and full transparency.

This document is the canonical product specification for DialerOS, written as a build prompt for engineering teams. Every feature, behavior, decision, and architecture choice is captured here.

---

## Table of Contents

1. [Product Vision & Positioning](#1-product-vision--positioning)
2. [Architecture Overview](#2-architecture-overview)
3. [Cluster Provisioning & Node Roles](#3-cluster-provisioning--node-roles)
4. [Core Telephony Stack](#4-core-telephony-stack)
5. [Carrier Management](#5-carrier-management)
6. [Campaigns & Pacing Engine](#6-campaigns--pacing-engine)
7. [In-Groups & Routing](#7-in-groups--routing)
8. [Call Menus (IVR)](#8-call-menus-ivr)
9. [Agent Management — Human Agents](#9-agent-management--human-agents)
10. [Agent Management — AI Agents (Master/Worker)](#10-agent-management--ai-agents-masterworker)
11. [AI Learning System](#11-ai-learning-system)
12. [Portable AI Memory (.dkb bundles)](#12-portable-ai-memory-dkb-bundles)
13. [Lead Management & Whitelist](#13-lead-management--whitelist)
14. [Recordings & Compliance](#14-recordings--compliance)
15. [Soundboard](#15-soundboard)
16. [Real-Time State System](#16-real-time-state-system)
17. [Supervisor Cockpit](#17-supervisor-cockpit)
18. [Logs, Observability & Developer Tools](#18-logs-observability--developer-tools)
19. [ViciDial Feature Parity Matrix](#19-vicidial-feature-parity-matrix)
20. [API & Integration Surface](#20-api--integration-surface)
21. [Tech Stack Summary](#21-tech-stack-summary)
22. [Capacity & Performance Targets](#22-capacity--performance-targets)
23. [Build Phases](#23-build-phases)
24. [Non-Goals & Explicit Tradeoffs](#24-non-goals--explicit-tradeoffs)

---

## 1. Product Vision & Positioning

**Product name:** DialerOS (working title — finalize branding before public launch)

**One-liner:** "The dialer that respects what ViciDial got right — and fixes what it didn't. Self-hosted, AI-native, GUI-driven, with operator-grade visibility."

### Core differentiators

- Self-hosted, air-gap capable, no GPUs required for operation
- GUI-driven cluster provisioning (root password → auto-install via Ansible)
- WebRTC browser agents (no Eyebeam, no softphone install)
- Optional AI agents using tiny local models (whisper.cpp, llama 1B-3B Q4, Piper TTS)
- AI learns from human agent decisions (RAG + nightly LoRA, not real-time weights)
- 2,000 concurrent calls / 200 agents on commodity hardware
- Full ViciDial feature parity for call-related features
- Master/Worker AI architecture for shared learning and scale
- Portable AI memory (.dkb bundles) — train once, deploy anywhere
- Open operator surface — every log, API, hook documented like ViciDial

### Target users

- BPOs / call centers running outbound and inbound campaigns
- Existing ViciDial operators ready to modernize
- Multi-tenant operators managing dialers for multiple customers
- Enterprises with regulated verticals needing self-hosted control
- AI-first companies replacing human agents with hybrid AI/human floors

### Pricing model (TBD — placeholder)

- Per-cluster license (perpetual or annual)
- Per-AI-agent runtime fees (separate from human agent count)
- Optional managed services tier
- Optional .dkb bundle marketplace revenue share

---

## 2. Architecture Overview

DialerOS is a clustered, multi-node system. The cluster has 5 logical roles, each can run on dedicated nodes or be co-located:

### Node roles

- **Master Node** — control plane, GUI, orchestration, config DB
- **Telephony Node** — Kamailio + FreeSWITCH for SIP/RTP handling
- **Web Node** — agent-facing WebRTC, supervisor UI, REST API
- **Database Node** — PostgreSQL primary + standby
- **AI Worker Node** — runs AI agent inference (worker AIs)

A small deployment runs all 5 on one box. A production deployment splits them.

### Data flow

```
Carrier ──SIP/RTP──► Telephony Node ──WebRTC──► Web Node ──► Browser Agent
                            │
                            ├──Lead lookup──► Database Node
                            │
                            └──AI inference──► AI Worker Node ──► Master Node
                                                                  (training)
```

### Cluster communication

- Internal RPC: gRPC over mTLS
- Event bus: Redis Streams (or NATS JetStream)
- Database replication: PostgreSQL streaming replication
- Config sync: master pushes config to all nodes via Ansible/agent

---

## 3. Cluster Provisioning & Node Roles

### Provisioning UX

Admin opens DialerOS GUI on the master node → "Add Node" button → enters:

- Node IP address
- Root password (for SSH bootstrap)
- Role to assign (telephony / web / database / ai-worker)

System then:

1. Connects via SSH using provided credentials
2. Hardens the node (creates dialeros user, disables root SSH)
3. Installs base dependencies via Ansible playbook
4. Installs role-specific software (Kamailio, FreeSWITCH, etc.)
5. Joins node to the cluster (registers with master, gets config)
6. Verifies health and reports status

**No manual configuration required after this** — operator only provides credentials, system handles everything. This is the single biggest UX win over ViciDial.

### Node types (detailed)

#### Master Node

- Runs control plane services
- Hosts admin GUI (Next.js/React)
- Holds config database
- Orchestrates cluster operations
- Handles AI master agents (training, RAG store)
- Single master per cluster (HA possible via standby)

#### Telephony Node

- Runs Kamailio (SIP proxy/load balancer)
- Runs FreeSWITCH (media server, recording, IVR execution)
- Handles all SIP signaling and RTP media
- Per-node capacity: 500 concurrent calls (typical)
- Multiple telephony nodes for horizontal scale

#### Web Node

- Serves agent WebRTC interface
- Hosts REST API for integrations
- Runs WebSocket server for real-time events
- Stateless, behind load balancer
- Multiple web nodes for HA

#### Database Node

- PostgreSQL 16+ primary
- Optional read replicas
- Stores: leads, campaigns, dispositions, recordings metadata, agent sessions, AI training data
- Backup with WAL archiving

#### AI Worker Node

- Runs Python/Pipecat-based AI agent runtime
- Loads LoRA weights from master agents
- Connects to RAG vector DB for retrieval
- Handles whisper.cpp STT + llama inference + Piper TTS
- Per-node capacity: 50 concurrent AI calls (typical, GPU-less)
- Multiple AI worker nodes for horizontal scale

---

## 4. Core Telephony Stack

### SIP proxy: Kamailio

- Handles SIP routing, authentication, ACLs
- IP-based and digest auth for trunks
- Load balances to FreeSWITCH instances
- Sub-millisecond decision making
- Custom routing modules for DialerOS logic

### Media server: FreeSWITCH

- Handles RTP, codec negotiation
- Records calls via mod_recording
- Executes IVR flows (call menus)
- Bridges legs for transfers
- Plays soundboard clips via uuid_displace
- WebRTC support via mod_verto

### WebRTC for agents

- Browser-based, no install
- Agent's mic/speaker via getUserMedia
- DTLS-SRTP encrypted by default
- Codec preference: Opus (high quality) → PCMU (carrier compatibility)
- Agent → Web Node (WebRTC) → Web Node bridges to FreeSWITCH (verto/SIP)

### Call leg architecture

```
Caller ◄──SIP/RTP──► Carrier ◄──SIP/RTP──► Kamailio ◄──► FreeSWITCH
                                                            │
                                                            ▼
                                                       Recording
                                                            │
                                                            ▼
                                                        Bridge to:
                                                        - Agent (WebRTC)
                                                        - AI worker (SIP)
                                                        - IVR (FreeSWITCH)
                                                        - Conference
                                                        - Voicemail
```

### Audio quality monitoring

- Per-call MOS, jitter, packet loss, RTT
- Active synthetic test calls every 5-15 min per carrier
- Carrier scoring (A/B/C/D/F daily report card)
- Auto-disable carriers below quality threshold

---

## 5. Carrier Management

### Carrier configuration (per-trunk)

**Authentication mode:**
- SIP digest (username/password)
- IP ACL (whitelisted source IPs)
- Hybrid (try IP first, fall back to SIP auth)

**Connection:**
- Carrier address (IP or hostname)
- SIP port
- Transport (UDP/TCP/TLS)
- Codec preference list (PCMU, PCMA, Opus, G.729)

**Number transformations (per-carrier):**
- Strip prefix (e.g., remove +, 0, 00, country code)
- Add prefix (e.g., prepend country code, carrier code)
- Pattern rewrite (regex-based)
- Per-destination overrides (mobile vs landline, region-specific)

**Capacity:**
- Max concurrent channels
- Calls per second rate limit
- Per-destination call caps

**Quality settings:**
- MOS threshold for auto-disable
- PDD (post-dial delay) threshold
- ASR (answer-seizure ratio) threshold

### Inbound carrier identification flow

1. INVITE arrives at Kamailio
2. Check source IP against carrier IP ACLs
   - Match → carrier identified, apply rules
3. If no IP match, check SIP digest credentials
   - Match → carrier identified, apply rules
4. If neither matches → reject (403 Forbidden)
5. Apply carrier-specific routing, prefix transforms, billing

### Route plans

A "route plan" is a named bundle that defines outbound dialing behavior:

- Primary carrier
- Failover carrier(s)
- CID pool to use (caller ID rotation)
- Codec preference
- Number transform rules
- Quality threshold (MOS minimum)
- Time-zone aware rules (only dial 8am-9pm caller local)
- LCR (least cost routing) rank

**Example route plan "Sales-USA":**

- Primary: Twilio US
- Failover: Bandwidth US
- CID pool: US-Local-Presence (5,000 DIDs)
- Codecs: PCMU, PCMA
- Transform: strip +, prepend 1
- MOS threshold: 3.8
- Time-zone: 8am-9pm caller local

### Carrier quality testing

- Heartbeat probe: SIP OPTIONS every 30 seconds (detects total trunk failure)
- Synthetic calls: real test call to known echo number every 5-60 min
- Measure: PDD, connect time, MOS, packet loss
- Daily report card per carrier with grade A/B/C/D/F
- Auto-disable below threshold, auto-re-enable after cooldown

---

## 6. Campaigns & Pacing Engine

### Campaign types (matching ViciDial)

- Outbound predictive
- Outbound progressive
- Outbound preview
- Outbound manual
- Inbound queue
- Survey (auto-IVR, no agent)
- Blended (inbound + outbound on same agents)

### Campaign configuration

**Identity:**
- Name, description, status (active/paused/archived)

**Lead source:**
- Linked lead lists
- Order: list_id ASC, then random within list
- Filters: status, custom fields, last_called_date

**Dial prefixes (key feature — same model as ViciDial):**
- Auto-dial prefix — for predictive/progressive (e.g., "9")
- Manual dial prefix — when agent manually dials (e.g., "8")
- Callback dial prefix — for scheduled callbacks (e.g., "7")
- Internal/transfer prefix — for in-cluster transfers (e.g., "6")

Each prefix maps to a Route Plan.

**Pacing:**
- Base ratio (e.g., 2.0 = dial 2 lines per available agent)
- Adaptive enabled (auto-tune based on actual answer rate)
- Per-agent overrides (Priya = 2.8, Neha = 1.2)
- Skill-based ratios (new agent 1.5, expert 2.5)
- Drop tolerance (max 3% abandoned per FCC/regulator)

**Compliance:**
- Time zone restrictions
- DNC list integration
- Recording disclaimer settings
- Per-jurisdiction announcement rules (TCPA, GDPR, etc.)

**Disposition codes:**
- Configurable per campaign
- SALE, NOT_INTERESTED, CALLBACK, WRONG_NUMBER, etc.
- Custom codes with auto-actions (e.g., DNC → add to suppression list)

### Pacing engine

The pacing engine treats both human and AI agents as "seats in the pool":

```
For each available agent:
  effective_ratio = agent.override_ratio
                    OR campaign.base_ratio
                    OR adaptive_calc(agent.history)

Total dial = sum of all effective ratios across available capacity slots
```

This makes per-agent ratio dialing possible (ViciDial only does per-campaign).

### Remote agent handling

- Detect agent network latency
- Adjust pacing for higher latency agents (slightly lower ratio)
- Buffer connect-to-agent time accordingly
- Avoids "hello, hello?" dropouts on lagged agents

---

## 7. In-Groups & Routing

In-groups = the "queues" that callers land in (matching ViciDial).

### In-group types

- **Inbound Queue** — accepts inbound calls only
- **Transfer Target** — only available as transfer destination
- **Both** — accepts inbound AND is a valid transfer target

### In-group configuration

**Identity:**
- Name, description
- Type (inbound / transfer / both)

**DIDs (for inbound type):**
- List of DIDs that route to this in-group
- Per-DID overrides if needed

**Whitelist mode (for inbound):**
- None — accept all callers
- Static list — uploaded CSV of allowed numbers
- Active campaign leads — only numbers in active campaigns
- Cluster-wide leads — ANY number in lead DB, ANY status, ANY campaign
- API-driven — real-time check against external CRM
- Hybrid — combine multiple modes with OR logic

**Routing strategy:**
- Ring all available agents
- Ring longest idle
- Ring random
- Skill + weight-based
- Time-of-day routing
- Geographic routing (caller IP)

**Queue settings:**
- Max wait time
- Music on hold (MOH) audio file
- Wrap-up timer after call (seconds before agent goes available)
- Overflow to fallback queue
- Position announcements ("you're number 3 in queue")
- Estimated wait time announcements

**Off-list calls (when whitelist match fails):**
- Reject with announcement
- Send to fallback IVR
- Route to general queue
- Voicemail box

### Cluster-wide lead whitelist (key feature)

- The most permissive whitelist mode
- Any number found in any lead list, any campaign, any status (NEW, CALLED, CONVERTED, LOST, DNC, etc.) gets through
- Only blocks numbers we've never touched (pure spam)
- Critical for: lost leads resurfacing, existing customer support, early callbacks, DNC leads calling for unrelated reasons
- DNC respect: DNC marker only applies to OUTBOUND, not inbound

### Inbound match flow

1. INVITE arrives at carrier-identified DID
2. Whitelist service queries lead DB for caller number
3. If match → attach full lead context (history, status, custom fields)
4. Route to configured in-group with screen pop
5. If no match → off-list handling (fallback IVR, reject, etc.)

---

## 8. Call Menus (IVR)

A "call menu" is an IVR node — plays a prompt, waits for DTMF, branches. ViciDial's exact concept, modernized with a visual flow editor.

### Call menu as universal routing

A call menu can be **entered from**:

- Inbound DID
- Survey campaign (outbound calls connect directly to call menu)
- Another call menu (for nested IVR trees)
- In-group overflow
- Agent transfer

A call menu can **route to**:

- In-group queue
- Another call menu
- External number
- Voicemail box
- DNC opt-out + announcement
- Agent (specific agent or pool)
- Hangup with announcement

### Call menu configuration

**Identity:**
- Name (e.g., MAIN_IVR, BILLING_IVR)
- Description

**Greeting:**
- Audio file (uploaded WAV or TTS-generated)
- Text-to-speech alternative if audio missing
- Multi-language support (one per locale)

**Pre-menu actions (run before greeting):**
- Play "calls may be recorded" notice
- Set call variables
- DNC pre-check
- Custom Lua/Python/JS hook

**DTMF branches:**
- Map "1", "2", "3"... "*", "#" to destinations
- Each branch: type (in-group / call-menu / external / voicemail / DNC) + target

**Timeout handling:**
- How long to wait for input (seconds)
- What to do on timeout (default destination)

**Invalid input handling:**
- How many retry attempts
- What to do after max retries

**After-hours route:**
- Time-of-day rules (e.g., 9am-6pm only)
- Outside hours: play "we're closed" message → hangup OR voicemail

**AI-augmented mode (optional):**
- "Speak naturally" instead of DTMF
- AI intent classifier routes based on speech
- Falls back to DTMF if classification fails

### Visual flow editor

- Drag-and-drop canvas
- Greeting node → DTMF branches → destination nodes
- Visualize entire IVR tree
- Test mode: simulate caller flow without making real calls
- Export/import as JSON

### Survey campaign mode

- Campaign type = Survey
- Outbound calls connect to a call menu instead of agent
- Caller responses captured to lead.custom_fields
- Auto-disposition based on responses
- Example: NPS_SURVEY captures 0-10 score → auto-dispose Detractor/Passive/Promoter

---

## 9. Agent Management — Human Agents

### Agent identity

- Username, password, email
- Display name
- Role (agent / supervisor / admin)
- Skill tier (new / certified / expert)
- User group membership

### User group permissions

- Allowed campaigns (can log into these)
- Allowed in-groups (can receive inbound from these)
- Allowed transfer groups (can transfer calls to these)
- Skill-based routing weight

### Agent login flow (ViciDial parity)

1. Agent logs in with credentials
2. Selects campaign from allowed list
3. Sees allowed in-groups for this campaign
4. Checks which in-groups to receive from this session
5. Picks phone setup (WebRTC / external SIP / dial-in bridge)
6. Clicks "Start Session"
7. State becomes AVAILABLE, pacing engine begins feeding

### Phone setup options

- WebRTC (browser) — default, no install
- External SIP softphone — custom credentials
- Dial-in to bridge — agent calls a number, system bridges them in
- Mobile callback — system calls agent's mobile when needed

### In-call UI

- Screen pop with lead info, history, custom fields
- Live transcript (if AI listening)
- Disposition selector
- Notes field
- Soundboard panel
- Transfer button → shows allowed transfer groups only
- Call control: hold, mute, transfer, hangup, conference

### Transfer flow

- Agent clicks Transfer
- UI shows ONLY their allowed transfer groups
- Agent selects target group + transfer type
  - Warm: announce to receiving agent first
  - Blind: immediate handoff
  - 3-way: conference all parties
- Pacing engine routes to next available agent in target group

### Agent states

| State | Color | Meaning |
|-------|-------|---------|
| AVAILABLE | green | ready to receive calls |
| ON_CALL | cyan | currently on a call |
| WRAP_UP | amber | post-call disposition entry |
| PAUSED | amber | manual pause + reason code |
| LUNCH | amber | lunch break |
| TRAINING | amber | coaching session |
| MEETING | red | off the floor |
| OFFLINE | gray | logged out |

### Pause reasons (configurable per tenant)

Lunch, Bathroom break, Training, Meeting, Coaching, Technical issue, Other

### State tracking

- Every state change timestamped
- Time-in-state metrics for SLA reporting
- Webhook events fired on transitions
- Audit trail per agent per shift

---

## 10. Agent Management — AI Agents (Master/Worker)

**Architecture:** Two-tier hierarchy.

### Master AI agent

- The "brain" — holds memory, learns, trains
- Doesn't take calls (typically)
- Created on AI Agents admin page
- Has portable .dkb bundle (exportable)
- Multiple masters per cluster, each with separate memory streams

### Worker AI agent

- The "body" — takes actual calls
- Inherits master's brain (live RAG read + loaded LoRA weights)
- Created on AI Agents admin page, assigned to a master
- Has own concurrency, voice, capacity
- Many workers can share one master
- Reports call outcomes back to master for learning

### Why master/worker

- One trained brain can power 50 worker bodies
- Workers in different campaigns share the same learning
- Master does heavy training (centralized, GPU optional)
- Workers do inference (distributed, CPU only)
- Adding a 51st worker inherits everything from day one

### Master AI creation (wizard)

**Step 1 — Master Identity:**
- Name (e.g., "Sales Master Brain")
- Description
- Default voice profile (Piper voice ID, ElevenLabs ID, etc.)
- Language(s) supported

**Step 2 — Memory Settings:**
- RAG retention window (e.g., 90 days rolling)
- LoRA training cadence (nightly / weekly / on-demand)
- Min calls before training (e.g., 100)
- Supervisor approval required before promotion (yes/no)

**Step 3 — Knowledge Base:**
- Upload campaign scripts
- Upload FAQ documents
- Upload pricing/product reference
- Define compliance constraints (do-not-say list)

**Step 4 — Learning Sources:**
- Pick CAMPAIGNS this master learns from (checkboxes)
- Pick IN-GROUPS this master learns from (checkboxes)
- Excluded sources never affect this brain
- Example: Sales master learns from SALES_OUTBOUND_USA and SALES_INBOUND but NOT from BILLING_OUTREACH

**Step 5 —** Save and create master.

### Worker AI creation (wizard)

**Step 1 — Worker Identity:**
- Name (e.g., "SalesBot-USA-1")
- Voice override (optional, defaults to master's)

**Step 2 — Master Assignment:**
- Pick which master this worker runs under
- Inherits master's RAG, LoRA, knowledge, compliance, voice

**Step 3 — Behavior:**
- Tone (professional / friendly / casual) — overrides master if set
- Pace (fast / normal / patient)
- Max call duration
- Mandatory disclosures on connect

**Step 4 — Skills (Allowed Actions):**
- continue_conversation (always on)
- confirm_appointment
- schedule_callback
- transfer_to_human
- mark_dnc
- escalate_to_supervisor
- make_payment_offer (only if explicitly enabled)
- Custom action plugins

**Step 5 — Access Permissions (matches human agent model):**

*Allowed Campaigns:*
- Pick which campaigns this worker can operate in
- Excluded campaigns won't dispatch calls to this worker

*Allowed In-Groups (for inbound):*
- Pick which in-groups this worker accepts calls from

*Allowed Transfer Groups:*
- Pick which groups this worker can transfer calls TO
- Same model as human agent transfer permissions
- Example: SalesBot can transfer to SALES_CLOSER, BILLING_DEPT, SUPERVISOR_ESCALATION but NOT to EXECUTIVES

*Default Transfer Mode:*
- Warm — AI explains context to human first (recommended)
- Blind — immediate handoff, no announcement
- Cold — context only on screen pop, no voice announcement

**Step 6 — Capacity:**
- Max concurrent calls (e.g., 10)
- Dial ratio (e.g., 1.5)
- Worker node assignment (which AI Worker Node runs this)
- Auto-restart on failure (yes/no)

**Step 7 —** Save and activate worker.

### Worker runtime behavior

When a worker takes a call:

1. Receives call from FreeSWITCH (SIP leg)
2. Loads master's current LoRA weights into local llama instance
3. Connects to master's RAG store for live retrieval
4. Greets caller using master's voice profile + pre-call context
5. STT (whisper.cpp) converts caller speech to text
6. LLM generates response using master's prompt + RAG context
7. TTS (Piper) converts response to audio
8. Audio streamed back to caller via FreeSWITCH

Decision points trigger "actions" from the allowed skill set:

- Continue conversation (default)
- Transfer (if allowed group + warm/blind/cold mode)
- Schedule callback
- Mark disposition and end call

After every call:

- Anonymize PII in transcript
- Send full call data (transcript, decisions, outcome) up to master
- Master ingests for RAG and queues for nightly LoRA training

---

## 11. AI Learning System

Three learning timeframes, all running in parallel:

### Within a call (real-time, instant)

- LLM tracks conversation history in context window
- Adapts tone, strategy based on caller signals
- Detects frustration, hesitation, confusion
- This is base LLM capability, no training needed

### Between calls (seconds)

- Every completed call's outcome captured
- Anonymized transcript embedded into vector DB
- Indexed by intent, outcome, success/failure
- Next AI call retrieves similar past situations via RAG
- Memory grows with every call

### Across calls (nightly)

- Approved transcripts feed LoRA fine-tuning
- Supervisor corrections weighted highest (10x signal)
- LoRA trained on top of base model (small adapter, ~50-200MB)
- Canary tested on hold-out set before deployment
- Auto-deployed if metrics improve, rolled back if not

### Training pipeline

```
Worker call → outcome captured →
  [RAG embedding] → vector DB (live, per-minute)
  [Training queue] → nightly batch →
    LoRA fine-tune → canary test →
      promote OR rollback → deploy to all workers
```

### Supervisor feedback loop

- Supervisor reviews calls in cockpit
- Marks AI decisions as good/bad with reason
- Bad decisions weighted heavily in training
- Examples of "bad": premature transfer, missed close, wrong answer, etc.
- Supervisor corrections become highest-quality training signal

### Learning data sources (per master)

1. Master's worker calls (own AI experience)
2. Human agent calls in master's allowed campaigns/in-groups (AI learns from human patterns)
3. Supervisor corrections
4. Marked-as-exemplar calls (manually flagged "this was perfect")

### Privacy handling

- All training data has PII automatically anonymized
- Names → "[NAME]"
- Phone numbers → "[PHONE]"
- Account numbers → "[ACCOUNT]"
- Dollar amounts → "[AMOUNT]"
- Per-tenant data isolation (tenant A's data never trains tenant B's master)

### No online weight updates

- We do NOT update model weights in real-time during calls
- Risk of catastrophic drift, prompt injection, hallucination
- All training is batched, validated, gated
- "Learning" in real-time means RAG retrieval, not weight updates

---

## 12. Portable AI Memory (.dkb bundles)

### Concept

A master AI's accumulated learning can be exported as a single portable file:

- filename: `<master-name>.dkb`
- format: signed, versioned bundle
- size: typically 200-400 MB

This .dkb file can be:

- Downloaded from one cluster
- Imported into another cluster
- Used to give a fresh master agent a head start
- Shared, licensed, sold

### Use cases

1. Multi-tenant operator: train once, deploy to all customer clusters
2. Sell trained agents: marketplace of pre-trained .dkb bundles
3. Regional rollout: train on US traffic, replicate to India cluster
4. DR / migration: backup cluster always has latest brain
5. Vendor portability: customer's accumulated training survives platform change

### Bundle contents (included)

- ✓ RAG vector memory (embeddings of past conversations, indexed by intent)
- ✓ LoRA weights (fine-tune deltas on top of base model)
- ✓ Decision patterns (what worked, what failed, in what context)
- ✓ Knowledge base (scripts, FAQs, product info, pricing)
- ✓ Voice / tone profile (calibrated pace, energy, personality)
- ✓ Compliance settings (do-not-say lists, disclosure templates)
- ✓ Anonymized stats (success rates, common objections, win paths)

### Never included

- ✗ Raw call audio recordings (stay in source cluster)
- ✗ Customer PII (names, phone numbers, account numbers — stripped)
- ✗ Carrier credentials (SIP usernames, passwords, IPs, API keys)
- ✗ Lead lists (customer-specific lead data never travels)
- ✗ CRM integration tokens (webhooks, OAuth tokens, secrets)
- ✗ Tenant configuration (cluster-specific settings, infrastructure)
- ✗ Recording transcripts (only patterns extracted)

### Export UI

AI Agents page → Master Agent → Memory tab → Export

Options:
- [✓] Anonymize PII automatically (always on, can't disable)
- [ ] Include voice samples (+80MB, optional)

Download Bundle button → produces signed .dkb file

### Import UI

AI Agents page → Import Bundle → 5-step wizard:

1. Upload .dkb file
2. Verify cryptographic signature (cluster cert validates source)
3. Inspect contents preview (what's inside)
4. Map references (transfer groups, campaigns from source → local)
5. Activate — new master agent live in <60 seconds

### Bundle format (technical)

- Signed with source cluster's Ed25519 private key
- Manifest.json with metadata (version, source, training stats)
- LoRA weights as safetensors files
- RAG embeddings as Parquet files
- Knowledge base as markdown
- Compressed with zstd

### Vendor portability guarantee

- Customer owns their trained brain
- Can export at any time
- DialerOS commits to maintaining .dkb format compatibility
- Open source format spec on GitHub
- No vendor lock-in via inaccessible model weights

---

## 13. Lead Management & Whitelist

### Lead data model

```
Lead {
  id, phone, name, email, custom_fields (JSON),
  status, list_id, campaign_id, last_called_at,
  disposition_history, notes, created_at
}
```

### Lead statuses

| Status | Meaning |
|--------|---------|
| NEW | fresh lead, never called |
| CALLED_NO_ANSWER | tried, no pickup |
| CALLBACK_SCHEDULED | scheduled for future call |
| INTERESTED | engaged in conversation |
| NOT_INTERESTED | declined offer |
| CONVERTED | became a customer |
| LOST | old lead, didn't convert |
| DNC | do-not-call (outbound only) |
| VOICEMAIL_LEFT | drop completed |
| WRONG_NUMBER | number didn't match lead |

### Custom fields

- Per-campaign or per-list field schema
- Stored as JSONB in Postgres
- Searchable, filterable
- Used for personalization in dialing and IVR

### Lead lists

- Container for related leads
- Linked to campaigns
- Can be active, paused, archived
- CSV upload, API push, or webhook-driven creation

### Lead-wide whitelist (key feature)

- For inbound DIDs and in-groups
- Whitelist mode: "Cluster-wide leads"
- Inbound number is checked against ENTIRE lead database
- ANY status (NEW, LOST, CONVERTED, DNC, etc.) is accepted
- Only blocks numbers we've never imported/dialed
- DNC respect: outbound blocked, but inbound allowed (they called us)

### Whitelist modes (5 options)

1. None (open) — accept all callers
2. Static list — uploaded CSV of allowed numbers
3. Active campaign leads — only numbers in currently-running campaigns
4. Cluster-wide leads — ANY number in lead DB, ANY status
5. API-driven — real-time check against external CRM
6. Hybrid — combine modes with OR logic

### Inbound lead match flow

1. Caller hits DID
2. Whitelist service queries lead DB for caller number
3. If match → attach full context (history, status, custom fields, notes)
4. Screen pop on agent's UI shows everything
5. Routed to configured in-group with priority based on lead status (e.g., CONVERTED customers go to VIP queue)

### Lead history display

- Past 4 calls with timestamps and dispositions
- All previous agent notes
- Custom field history (changes over time)
- Linked tickets / orders (if CRM integrated)

---

## 14. Recordings & Compliance

### Recording policy

- All calls recorded by default (configurable per campaign)
- Stored as encrypted files at rest (managed keys)
- Standard encryption (NOT customer-held keys, see decision below)

### Encryption decision (important architectural choice)

- We use **standard at-rest encryption with managed keys**
- We do NOT use customer-held key encryption
- Reason: customer-held keys would block AI from accessing transcripts and audio for learning, defeating the AI-first product vision
- Recording transit: SRTP between agent/AI and FreeSWITCH (DTLS)
- Recording at rest: AES-256-GCM with cluster-managed master key
- Key rotation: quarterly, automatic
- Compliance: sufficient for HIPAA, PCI-DSS, SOC 2 with proper access controls

### Pause-and-resume recording (for PCI compliance)

- Agent clicks "Pause Recording" before card capture
- Recording stops, gap is logged in CDR (timestamped)
- Agent reads card or uses DTMF capture
- Agent clicks "Resume Recording"
- Recording continues, gap remains in file

### DTMF masking

- Caller punches card number via DTMF (never speaks it)
- Tones routed directly to payment processor's tokenization API
- DTMF tones masked out of recording entirely
- Agent never sees or hears the card number — full PCI scope reduction

### Voicemail drop handling

- Voicemail drop messages should NOT contain sensitive PII
- System TTS engine has PII detector
- Refuses to render TTS containing flagged patterns:
  - Account numbers
  - SSN-like patterns
  - Dollar amounts above threshold
- Use token-based callbacks instead: "please call us back at..."

### Access control for recordings

- Permission gate on every playback request
- Audit log entry per playback (user, time, reason, IP)
- 2-person rule supported (some compliance regimes require this)
- Mandatory hold period configurable (e.g., 7 days minimum before access)

### Compliance regime support

| Regime | Mechanism |
|--------|-----------|
| PCI-DSS | pause-resume + DTMF masking + tokenization |
| HIPAA | encryption at rest + access control + audit log |
| GDPR | right to deletion (key destruction = effective deletion) |
| MiFID II | 5-year retention + WORM storage + cryptographic signing |
| SOC 2 | every action logged with user, time, IP, reason |
| TCPA | per-jurisdiction announcement on call connect |

### Retention policy

- Configurable per campaign (e.g., 90 days, 1 year, 7 years)
- Auto-deletion after retention window
- Legal hold capability (override deletion)
- Archive to cold storage (S3 Glacier, etc.) after 30 days

---

## 15. Soundboard

### Concept

Pre-recorded audio clips that an agent triggers during a live call. Critical for international/offshore call centers where agents handle calls in languages they don't natively speak.

### Soundboard configuration

Per campaign:

- Library of audio clips (uploaded WAV/MP3)
- Categorized: openers, rebuttals, product, objections, closers, hold
- Hotkey assignment (1-9, Q-W-E-R-T, custom keyboard shortcuts)
- Per-clip metadata: title, transcript, language

### Agent UI

- Soundboard panel visible during call
- Tabs for categories (Openers, Rebuttals, Product, etc.)
- Each clip shown as a button with hotkey badge + title + snippet
- Press hotkey OR click button → clip plays into call

### Clip playback mechanism

- FreeSWITCH `uuid_displace` command injects audio into caller's leg
- Agent's mic auto-mutes during clip playback
- Agent's mic auto-unmutes after clip ends
- Multiple clips can be queued (sequential playback)
- Clips can be interrupted (stop button)

### Hybrid speaking mode

- Agent can speak live AND play clips
- Audio blends seamlessly via mixing
- Use cases:
  - Intro clip in target language → agent fills in details
  - Generic objection handler clip → agent speaks specific response
  - Closing pitch clip → agent confirms details

### Clip usage analytics

- Every clip play logged to CDR
- Per-clip statistics:
  - Times played
  - Conversion rate when used
  - Average call duration after play
- Identify which clips drive conversions

### Multi-language support

- One soundboard library per language
- Switch language per call or per campaign
- Same script structure, different audio per language
- Useful for offshore agents handling multilingual customers

---

## 16. Real-Time State System

### WebSocket-driven presence

- All agent state changes pushed via WebSocket
- Sub-second latency
- Supervisor cockpit updates instantly

### Agent states (8 standard)

| State | Color | Meaning |
|-------|-------|---------|
| AVAILABLE | green | Ready to receive call |
| ON_CALL | cyan | Talking with caller |
| WRAP_UP | amber | Post-call disposition |
| PAUSED | amber | Manual pause + reason |
| LUNCH | amber | Lunch break code |
| TRAINING | amber | Coaching session |
| MEETING | red | Off the floor |
| OFFLINE | gray | Logged out |

### State transition tracking

- Every transition timestamped
- Stored in `agent_state_history` table
- Time-in-state metrics available
- Used for SLA reporting, shift analytics, payroll integration

### Live floor view (supervisor)

- Color-coded grid of all agents
- Real-time state indicators
- Per-agent metrics (calls today, AHT, dispositions)
- Filter by team, campaign, in-group
- Click agent to see live call (whisper, barge, take-over)

### KPI summary strip

- ONLINE count
- AVAILABLE count
- ON_CALL count
- WRAP_UP count
- PAUSED count
- Updated in real-time

### Webhook events fired on state changes

- agent.login
- agent.logout
- agent.state_change
- agent.pause
- agent.resume
- agent.call_start
- agent.call_end
- agent.disposition_set

External systems (CRM, BI, payroll) can subscribe.

---

## 17. Supervisor Cockpit

The supervisor's main dashboard.

### Live floor view

- Grid of all agents (humans + AI workers, color-coded)
- Real-time states
- Per-agent KPIs
- Click agent to drill in

### Live call monitoring

- See all active calls
- Click call to listen in:
  - Listen mode (silent, agent doesn't know)
  - Whisper mode (only agent hears supervisor)
  - Barge mode (3-way conference)
  - Take-over (supervisor takes over the call)

### Queue status

- Inbound queues with current wait times
- Calls in queue, longest wait
- Service level metrics (% answered within X seconds)
- Color-coded urgency

### Campaign monitoring

- Per-campaign call volume
- Connect rate, conversion rate
- Pacing engine status (lines dialing, agents available)
- Drop rate (must stay under 3% for FCC compliance)

### Alerts

- High drop rate → red alert
- Long queue wait → yellow alert
- Carrier quality issues → red alert
- Agent state stuck (e.g., 30+ min in PAUSED) → notification

### Reporting (built-in)

- Daily call volume
- Per-agent productivity
- Per-campaign performance
- Disposition breakdown
- Conversion funnel
- AI vs human comparison
- Carrier performance scorecards

### Export

- All reports exportable to CSV, PDF
- Scheduled email reports
- Custom report builder (drag-drop fields)

### AI supervision features

- Review AI agent calls
- Mark decisions as good/bad with reason
- Approve/reject promoted models
- Adjust master agent's learning rules
- View AI confidence scores per decision

---

## 18. Logs, Observability & Developer Tools

### Live logs page

- Stream all logs in real-time
- Filter by:
  - Source (Application, SIP, RTP, Carrier, AI Decisions, Audit)
  - Severity (DEBUG, INFO, WARN, ERROR)
  - Node (telephony-01, web-02, ai-worker-03, etc.)
  - Time range
  - Regex search

### Log sources

| Source | Content |
|--------|---------|
| Application logs | what the dialer is doing |
| SIP signaling logs | raw INVITE, OPTIONS, BYE traffic |
| RTP quality logs | jitter, packet loss, MOS |
| Carrier event logs | auth attempts, channel state |
| AI decision logs | why AI transferred, what RAG influenced it |
| Audit logs | who changed what config, when |

### Per-call detail view

- Click any call → see complete timeline
- SIP messages with full headers (raw INVITE, 200 OK, BYE)
- DTMF events with timestamps
- RTP quality over time (jitter, packet loss, MOS chart)
- Recording player (with scrubbing, transcript overlay)
- AI decision points with reasoning
- Transfer events
- Audit trail (who accessed this call's data)

### Inspection tabs per call

- SIP Messages
- RTP Quality
- DTMF Events
- AI Decisions
- Recording
- Audit Trail

### Developer documentation

#### REST API reference

- Auto-generated from OpenAPI 3.0 spec
- Every endpoint, parameter, response schema
- Try-it-now in browser
- Authentication: API keys + OAuth 2.0
- Rate limits documented per endpoint

#### Webhook event catalog

- Every event the system emits
- Event schema for each
- Sample payloads
- Subscribe via HTTPS endpoint or WebSocket
- Examples:
  - call.start
  - call.end
  - call.transfer
  - agent.state_change
  - lead.disposition
  - campaign.start
  - ai.decision

#### Script hooks (AGI-equivalent)

- Embed Lua, Python, or JavaScript at call lifecycle points
- Same flexibility as ViciDial AGI, modern languages
- 12 hook points:
  - pre_dial
  - post_connect
  - pre_transfer
  - post_transfer
  - pre_hangup
  - post_disposition
  - on_voicemail_detected
  - on_dtmf_received
  - on_ai_decision
  - on_supervisor_action
  - custom_route_logic
  - custom_pacing_logic

#### Database schema

- Full PostgreSQL schema documented
- Customer can query directly for analytics, BI, reporting
- All tables, columns, indexes documented
- Foreign key relationships diagrammed

#### ViciDial migration guide

Concept-by-concept mapping. Side-by-side reference. Examples:

- `asterisk_log` → Live Logs page (`/admin/logs`)
- AGI scripts → Script hooks (`docs/script-hooks`)
- MySQL queries → PostgreSQL with documented schema
- `NON-AGENT_API.php` → REST API + WebSocket events
- `AST_VDauto_dial.pl` → Built-in pacing engine
- `extensions.conf` → Route Plans + Call Menu builder (GUI)
- `sip.conf` → Carrier management page (GUI)

### Open-source components

- Operator UI components (open source where possible)
- Migration tooling (ViciDial → DialerOS scripts)
- Sample integrations (CRMs, BI tools)
- Reference deployments (Docker Compose, Kubernetes Helm)
- MIT-licensed where possible

### Community resources

- docs.dialeros.com
- github.com/dialeros
- discord.gg/dialeros (or community forum)
- Public roadmap
- Migration support forum

---

## 19. ViciDial Feature Parity Matrix

### Call control

- ✓ 3-way calling and conferencing
- ✓ Auto-alt-dial (try alt number if primary doesn't connect)
- ✓ Call parking + retrieval
- ✓ Transfer to extension/queue/IVR
- ✓ Drop SIP audio mid-call
- ✓ Hold with custom MOH
- ✓ Music on hold per campaign

### IVR & DTMF

- ✓ DTMF capture and storage
- ✓ IVR menu builder (drag-drop visual + form-based)
- ✓ Conditional menu logic
- ✓ Voicemail boxes per agent
- ✓ Voicemail-to-email
- ✓ Custom prompts per language
- ✓ Menu nesting (unlimited)

### Routing strategies

- ✓ Ring all available agents
- ✓ Ring longest idle
- ✓ Ring random agent
- ✓ Skill + weight-based routing
- ✓ Time-of-day routing
- ✓ Geographic routing (caller IP)
- ✓ Overflow / fallback queues

### Carrier side

- ✓ DNIS-based routing
- ✓ ANI manipulation rules
- ✓ Inbound DID routing tables
- ✓ Outbound call cap pacing
- ✓ Per-trunk channel limits
- ✓ Webhooks on call lifecycle
- ✓ AGI-equivalent script hooks

### Campaign management

- ✓ Outbound predictive
- ✓ Outbound progressive
- ✓ Outbound preview
- ✓ Outbound manual
- ✓ Inbound queue
- ✓ Survey (auto-IVR)
- ✓ Blended (inbound + outbound)
- ✓ Lead list management
- ✓ Custom dispositions
- ✓ Per-campaign dial prefixes

### Agent features

- ✓ Login flow with campaign + in-group selection
- ✓ Allowed transfer groups (per-agent)
- ✓ Pause reasons (configurable)
- ✓ Manual dial
- ✓ Callback scheduling
- ✓ Custom dispositions
- ✓ Notes and custom fields
- ✓ Lead history view

### Reporting

- ✓ Real-time agent stats
- ✓ Campaign performance
- ✓ Disposition breakdown
- ✓ Per-agent productivity
- ✓ Carrier scorecards
- ✓ Call recordings access

### DialerOS adds (beyond ViciDial)

- + Per-agent dial ratio (vs ViciDial campaign-wide)
- + AI agents (master/worker hierarchy)
- + Live logs page (vs ViciDial's tail-the-file approach)
- + Visual call flow editor (drag-drop)
- + WebRTC browser agents (no softphone)
- + Real-time supervisor cockpit (vs ViciDial's polling)
- + Soundboard with hotkeys
- + Carrier quality testing (active probes)
- + Cluster-wide lead whitelist (any status)
- + Portable AI memory (.dkb bundles)
- + REST API + webhooks (vs ViciDial's NON-AGENT_API.php)
- + Modern documentation site

---

## 20. API & Integration Surface

### REST API

- OpenAPI 3.0 spec
- 200+ endpoints
- Authentication: API keys + OAuth 2.0
- Rate limits per tenant

### Endpoint categories

| Path | Purpose |
|------|---------|
| `/campaigns` | manage campaigns |
| `/leads` | manage leads, lists |
| `/agents` | manage human agents |
| `/ai-agents` | manage AI agents |
| `/in-groups` | manage in-groups |
| `/carriers` | manage carriers, route plans |
| `/calls` | query call history, recordings |
| `/reports` | pull reports, metrics |
| `/webhooks` | manage webhook subscriptions |
| `/audit` | query audit log |

### Webhooks

60+ event types. Subscribe via HTTPS endpoint or WebSocket.

**Event examples:**

- call.start
- call.connect
- call.transfer
- call.end
- call.disposition_set
- agent.login
- agent.logout
- agent.state_change
- agent.pause
- ai.decision
- ai.transfer_initiated
- campaign.start
- campaign.pause
- campaign.lead_exhausted
- carrier.quality_alert
- carrier.disabled
- recording.available
- voicemail.received

### Integration recipes (sample)

- **Salesforce:** bidirectional lead sync, screen pop, disposition push
- **HubSpot:** contact sync, call logging, pipeline updates
- **Zendesk:** ticket creation from calls, agent context
- **Slack:** alerts, daily reports, agent notifications
- **Twilio:** trunk integration, SMS follow-up
- **Custom CRM:** REST API + webhook reference architecture

### Custom script hooks

- Lua, Python, or JavaScript
- Embedded at 12 lifecycle points
- Sandboxed execution (no filesystem access by default)
- Resource limits (CPU, memory, time)
- Tested via dry-run mode

### Example hook use cases

- Custom routing logic (route VIP leads to top agents)
- Dynamic CID selection based on lead area code
- Real-time CRM lookups before connecting
- Custom disposition automation (DNC after 3 not_interested)
- AI agent guardrails (block certain topics)

---

## 21. Tech Stack Summary

### Languages & frameworks

**Backend:**
- Node.js (control plane, API services)
- Python (AI worker runtime, training pipelines)
- Go (high-performance services where needed)

**Frontend:**
- React + Next.js (admin GUI, agent UI, supervisor cockpit)
- WebRTC for browser telephony
- Tailwind CSS for styling
- shadcn/ui component library

### Telephony

- Kamailio (SIP proxy/router)
- FreeSWITCH (media server)
- PJSIP-based libraries where embeddable

### Databases

- PostgreSQL 16+ (primary OLTP)
- Redis (caching, queues, real-time state)
- Qdrant or pgvector (RAG vector store)
- S3-compatible object storage (recordings, .dkb bundles)

### AI stack

- Pipecat (orchestration framework)
- whisper.cpp (STT, runs on CPU)
- llama.cpp (LLM inference, 1B-3B Q4 models, CPU)
- Piper (TTS, lightweight)
- PyTorch (training pipelines)
- PEFT/LoRA (parameter-efficient fine-tuning)

### Infrastructure

- Ansible (cluster provisioning)
- Docker (containerization, optional)
- Kubernetes (optional, for cloud deployments)
- Prometheus + Grafana (metrics)
- Loki (log aggregation)

### Development

- GitHub (source control, public repos for OSS components)
- GitHub Actions (CI/CD)
- Cypress / Playwright (E2E tests)
- pytest, jest (unit tests)

---

## 22. Capacity & Performance Targets

### Minimum viable cluster (1 box)

- 100 concurrent calls
- 20 agents
- 5 AI workers
- Single node, all roles co-located
- 16GB RAM, 8 cores, 200GB SSD

### Production cluster (small)

- 500 concurrent calls
- 50 agents
- 25 AI workers
- 3-5 nodes (1 master + 2 telephony + 1 db + 1 ai-worker)
- Each node 32GB RAM, 16 cores

### Production cluster (large)

- 2,000 concurrent calls
- 200 agents
- 100 AI workers
- 10-15 nodes
- Each node 64GB RAM, 32 cores

### Performance benchmarks

- SIP routing decision: <1ms at Kamailio
- Call setup time: <500ms median
- Agent screen pop: <300ms after answer
- AI agent first response: <800ms (TTFA — time to first audio)
- WebRTC latency: <100ms in same region
- Database query (lead lookup): <10ms p99
- RAG retrieval: <50ms p99 (k=5)

### Scaling approach

- Horizontal: add nodes for more telephony, AI workers
- Vertical: increase RAM/CPU for database, master
- Database: read replicas for analytics queries
- AI: GPU nodes optional for faster training (not required)

---

## 23. Build Phases

### Phase 0 — Foundations (8 weeks)

- Cluster provisioning (Ansible playbooks)
- Master/Telephony/Web/DB/AI-Worker node types
- Basic admin GUI shell
- Authentication, multi-tenancy
- Audit logging foundation

### Phase 1 — Core Telephony (12 weeks)

- Kamailio + FreeSWITCH integration
- Carrier management (SIP digest + IP ACL)
- Outbound dialing (manual mode first)
- Inbound DID routing
- Basic agent UI (WebRTC)
- Call recordings

### Phase 2 — Campaigns & Agents (8 weeks)

- Campaign management
- Lead lists
- Predictive pacing engine
- Per-agent ratio dialing
- Dispositions, callbacks
- Real-time state system
- Supervisor cockpit (basic)

### Phase 3 — In-Groups, IVR, Routing (8 weeks)

- In-groups (inbound, transfer, both)
- Whitelist modes (all 5 + hybrid)
- Cluster-wide lead whitelist
- Call menus (form-based first)
- Survey campaigns
- Soundboard

### Phase 4 — AI Agents V1 (12 weeks)

- AI worker runtime (Pipecat-based)
- Single-model AI agents
- Whisper + llama + Piper integration
- Predictive dialing with AI seats
- Basic RAG memory
- Warm transfer to humans

### Phase 5 — Master/Worker AI (8 weeks)

- Master agent abstraction
- Worker assignment to masters
- Shared RAG between workers
- LoRA training pipeline
- Nightly fine-tune + canary
- Supervisor feedback loop

### Phase 6 — Portability & Polish (6 weeks)

- .dkb bundle export/import
- PII anonymization
- Cluster-to-cluster migration
- Documentation site
- REST API publication
- Webhooks
- ViciDial migration tooling

### Phase 7 — Visual Tools (6 weeks)

- Visual call flow editor (drag-drop)
- Visual route plan builder
- Visual campaign workflow editor
- Live logs UI

### Phase 8 — Enterprise Features (8 weeks)

- Advanced compliance (PCI pause-resume, DTMF masking)
- HIPAA-grade audit
- Multi-region replication
- High-availability master node
- Advanced reporting

### Phase 9 — Community & Ecosystem (ongoing)

- Open-source UI components
- Migration tooling improvements
- Reference integrations
- Developer marketing
- Conference talks, blog posts

### Totals

- TO MVP: ~36 weeks (Phase 0-3)
- TO AI-ENABLED PRODUCT: ~56 weeks (Phase 0-5)
- TO ENTERPRISE-READY: ~76 weeks (Phase 0-8)

---

## 24. Non-Goals & Explicit Tradeoffs

### Not goals (intentionally out of scope)

#### No customer-held key encryption

- Decision: standard at-rest encryption with managed keys
- Reason: customer-held keys block AI from accessing data for learning
- Mitigation: managed encryption + access controls + audit log is sufficient for HIPAA, PCI-DSS, SOC 2 compliance

#### No real-time weight updates

- Decision: AI training is batched (nightly LoRA fine-tune)
- Reason: real-time weight updates risk catastrophic drift, prompt injection, hallucination
- Mitigation: RAG retrieval is real-time, weights are stable

#### No blockchain / Web3 features

- Decision: no decentralized identity, no token-based auth
- Reason: doesn't solve any real problem in this domain
- Standard auth + standard databases are correct

#### No mobile native apps (V1)

- Decision: WebRTC in mobile browser is sufficient initially
- Native apps are a Phase 9+ consideration
- Mobile web works for supervisor monitoring on the go

#### No built-in CRM

- Decision: integrate with existing CRMs, don't build one
- Reason: massive scope creep, weak value-add
- Mitigation: rich API + webhooks + reference integrations

#### No built-in SMS/email campaign

- Decision: voice-only platform
- Reason: focus, do one thing well
- Mitigation: webhook integrations with Twilio, SendGrid, etc.

#### No proprietary voice models

- Decision: use open-source TTS (Piper) and STT (whisper.cpp)
- Reason: openness, on-premise capability, no vendor lock-in
- Customers can BYO model if they want premium voices (ElevenLabs, etc.)

#### No vendor lock-in on trained AI

- Decision: .dkb format is open and portable
- Customers can export and leave at any time
- Reason: trust, sustainability, ethical AI ownership

### Explicit tradeoffs we accept

#### Lower voice quality vs premium vendors

- Piper TTS is good but not as natural as ElevenLabs
- We accept this for on-premise/no-GPU operation
- Premium voices available as paid add-on

#### Slower AI inference vs GPU platforms

- 800ms TTFA on CPU vs ~400ms on GPU
- Acceptable for most use cases
- GPU optional for those who need faster

#### Nightly training vs continuous learning

- We accept 24h delay for safety
- Real-time adaptation via RAG, not weights

#### Larger memory footprint

- Master agents hold significant RAG + weights
- Trade off for better quality and shared learning
- Mitigation: configurable retention windows

---

## End of Specification

This document represents the complete DialerOS product vision as captured across the design conversations. Every feature, decision, and architectural choice should trace back to one of these sections.

For visual references and pitch materials, see the 7 PowerPoint decks:

1. `DialerOS_Pitch.pptx` — Main investor pitch
2. `DialerOS_Concerns_Answered.pptx` — Feature parity pushback
3. `DialerOS_Tech_Features.pptx` — Technical evaluation
4. `DialerOS_Operator_Workflows.pptx` — ViciDial migration story
5. `DialerOS_AI_Agents.pptx` — AI strategy
6. `DialerOS_Portability_Access.pptx` — Multi-cluster + lead-wide whitelist
7. `DialerOS_Brains_Visibility.pptx` — Master/Worker AI + community openness

Total: 84 slides across 7 decks.

This is the canonical reference. All future product decisions should reference this document, and divergences should be explicitly documented with rationale.

_Last updated: May 2026_
