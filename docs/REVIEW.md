# Spec Review — DialerOS

This is a critical pass over [SPEC.md](../SPEC.md). Issues are grouped by severity. Each one is a thing to decide on or fix before implementation locks it in.

Severity legend:
- **🔴 BLOCKER** — wrong direction, will need rework if not addressed
- **🟠 HIGH** — material risk (legal, capacity, security) — decide explicitly
- **🟡 MEDIUM** — costly later, cheap now
- **🟢 LOW** — nit / clarification

---

## 🔴 BLOCKER — Data isolation contradicts portability (§11 vs §12)

**The conflict:**
- §11 promises: _"Per-tenant data isolation (tenant A's data never trains tenant B's master)"_
- §12 enables: a master AI trained on Customer A's calls can be exported as `.dkb` and imported into Customer B's cluster — including LoRA weights, RAG embeddings, decision patterns, and "anonymized stats."

**The problem:** "Anonymized PII" does not mean "anonymized signal." LoRA weights and conversational embeddings carry:
- Customer A's pricing strategy
- Customer A's objection handlers
- Customer A's deal-specific scripts
- Conversational fingerprints that reveal which industry, vertical, region

If a BPO trains a master on a financial-services client's traffic and ships that `.dkb` to a competitor's cluster, you have a leak — even if every name and phone number is scrubbed.

**Decisions needed:**
1. Is `.dkb` portability **within a tenant only** (move between your own clusters), or **cross-tenant** (sell/share)?
2. If cross-tenant: does export require **consent of every tenant whose data trained the master**? How is that captured contractually?
3. Should masters be **scoped to a tenant**, with a separate "blank model + your scripts only" export mode for cross-tenant sharing?

Recommended default: **masters are tenant-scoped; cross-tenant export strips LoRA + RAG and exports only knowledge base + voice profile.** Position the marketplace as "trained on _your own_ corpus" not "buy someone else's brain."

---

## 🔴 BLOCKER — AI-worker capacity numbers don't math (§22)

**Spec claim:** 100 AI workers / 50 concurrent AI calls per node / 64GB / 32 cores.

**Reality on CPU-only:**
- Whisper.cpp small/base sustained streaming: ~0.5–1 vCPU per active stream.
- llama.cpp Q4 1B-3B at conversational latency: ~2–4 cores during generation, GPU-or-bust above ~5 concurrent generations per box.
- Piper TTS: cheap (~0.2 vCPU per stream).
- Plus FreeSWITCH SIP leg per call (~0.3 vCPU).

50 concurrent AI conversations on a 32-core box implies 32 cores doing 50 simultaneous Whisper transcriptions + 50 simultaneous llama generations + 50 TTS streams. **That's not happening at <800ms TTFA on CPU.**

Realistic: **10–15 concurrent AI calls per 32-core CPU node**, or quadruple to 50 with a single mid-range GPU per node.

**Decision needed:** either (a) walk back the 2,000-call AI ceiling, (b) make GPU **standard** for AI worker nodes (contradicts §1's "no GPUs required"), or (c) clarify that the 2,000-call number is human seats and AI is a smaller fraction.

---

## 🔴 BLOCKER — DNC on inbound creates outbound TCPA exposure (§7, §13)

**Spec says:** _"DNC marker only applies to OUTBOUND, not inbound"_ — a DNC'd lead can still call in.

**Gap:** Once the inbound call lands on an agent and the agent schedules a callback or marks `CALLBACK_SCHEDULED`, the system will dial out to a DNC number. That callback is an **unconsented outbound** in TCPA / DNC regimes.

**Required:**
- Inbound calls from DNC'd leads must be flagged in screen pop.
- Callback scheduling on a DNC'd lead must require **re-consent capture** (audio clip + agent attestation).
- Pacing engine must hard-block outbound to DNC numbers regardless of `CALLBACK_SCHEDULED` status, unless an explicit consent record exists.

Add as a §13 sub-section: "DNC + Callback Interaction."

---

## 🟠 HIGH — Recording encryption decision forecloses an enterprise sale (§14)

**Spec stance:** managed keys only. _"Customer-held keys would block AI from accessing transcripts and audio for learning."_

**Why this is wrong:** transcripts are **derived data** that can live under platform-managed encryption with explicit consent for AI training, while **raw audio at rest** sits under customer-held envelope encryption. Many regulated buyers (banks, healthcare, EU public sector) require BYOK as a procurement gate. Foreclosing this loses deals you'd otherwise win.

**Recommendation:** support **two-tier encryption**:
- Tier 1 (default): managed keys, AI training enabled.
- Tier 2 (enterprise add-on): customer-held envelope keys for raw audio + retention store. Transcripts opt-in for AI training; opt-out → that tenant's calls don't feed any master.

Don't promise it for v1, but don't paint yourself into the corner in §14 and §24.

---

## 🟠 HIGH — Three scripting languages for hooks is a sandbox liability (§18, §20)

Spec says script hooks support **Lua, Python, JavaScript**. Each requires:
- A separate sandbox (V8 isolate, restricted Python, restricted Lua state)
- Separate resource limits + observability
- Separate documentation + test harness
- Separate security audit

Three sandboxes is roughly 3× the security surface and 3× the maintenance cost for a feature most operators will use lightly.

**Recommendation:** pick one — **Python only** (already required for AI worker stack, biggest ecosystem, broadly known). Document the choice and move on.

---

## 🟠 HIGH — "Cold transfer" mode is a UX + compliance hazard (§10)

Worker AI's transfer modes include:

> Cold — context only on screen pop, no voice announcement

This means the human agent picks up a live caller mid-conversation with no warning, no greeting handoff, and no audible bridge. In regulated verticals (healthcare, financial) the lack of a controlled handoff can violate disclosure requirements. Even in non-regulated contexts it produces a bad customer experience ("...hello? Are you there?").

**Recommendation:** drop "cold" from the v1 transfer modes. Keep warm + blind (matching ViciDial). Add a configurable inter-leg announcement so even blind transfers get a "transferring you to John in our billing team" stinger.

---

## 🟠 HIGH — FCC 3% abandon rate is poorly specified (§6)

Spec mentions "Drop tolerance (max 3% abandoned per FCC/regulator)" but doesn't define:
- **Window**: 30 calendar days, rolling per campaign per calling area code
- **Numerator**: abandoned = answered by human but no agent within 2 seconds
- **Denominator**: total live answers (not total dials)
- **Enforcement**: pacing engine must throttle when 30-day rolling rate approaches 2.5%

ViciDial implementations get this wrong constantly and operators get FCC notices. Spec this precisely in §6 to avoid inheriting the same bug.

---

## 🟠 HIGH — "Supervisor corrections weighted 10× signal" is wrong shape (§11)

Spec describes mixing supervisor corrections at 10× weight in LoRA fine-tuning. Two issues:

1. **Magnitude is unjustified.** 10× appears chosen by feel.
2. **Wrong technique.** A small high-quality dataset mixed with a large noisy one is better handled with **staged training** (pretrain on raw approved transcripts → fine-tune on supervisor corrections) or **DPO/RLAIF** style preference learning, not weighted upsampling.

**Recommendation:** rewrite §11 training cadence as:
- Stage 1 (nightly): RAG ingestion of all approved transcripts
- Stage 2 (weekly): LoRA fine-tune on raw approved set
- Stage 3 (weekly, after Stage 2): preference fine-tune (DPO) on supervisor good/bad pairs

Cleaner pipeline, defensible methodology, fewer magic numbers.

---

## 🟡 MEDIUM — Three primary backend languages is team-tax (§21)

Spec lists Node + Python + Go as primary backend languages. For a startup-scale team:
- Node — control plane, API
- Python — AI workers (unavoidable, ecosystem is here)
- Go — "where needed" (pacing? whitelist?)

Each language adds: separate CI, separate dependency security review, separate hiring profile, separate observability stack. Pick **Node OR Go** for the control plane and stop. Use Python only inside AI services. Defer Go until profiling proves a real hot-loop bottleneck.

---

## 🟡 MEDIUM — `.dkb` bundle size estimate is optimistic (§12)

Spec: _"size: typically 200-400 MB"_

Reality:
- LoRA adapter for a 3B model: 50–200 MB ✓
- RAG embeddings for 90 days of mid-volume traffic (say 10k calls/day, 5 chunks each, 1024-dim float32): ~18 GB raw, ~5 GB compressed
- Knowledge base: small, KB to MB
- Voice samples (optional): 80 MB

A busy master will produce **multi-gigabyte** bundles. Update §12 size estimate and add tiering: "compact" (LoRA + KB only, 100 MB) vs "full" (with RAG, can be GB-scale).

---

## 🟡 MEDIUM — `extensions.conf` → "GUI" mapping is too glib (§18)

The ViciDial migration guide claims `extensions.conf` maps to "Route Plans + Call Menu builder (GUI)." That undersells the scope. Real-world ViciDial deployments encode meaningful business logic in the dialplan that GUI editors can't express (custom DTMF handling, conditional routing on CDR state, etc.). The migration tool needs a **scripted-fallback** option (the Python script hook) for dialplan logic that doesn't fit the form-based editor.

---

## 🟡 MEDIUM — No mention of test/staging tenant isolation

Multi-tenant systems need a clear story for:
- Test data isolation in production (does a tenant's QA team get a sandbox tenant?)
- Beta cohort routing (can a master be promoted to 5% of workers first, not all-or-nothing?)

Spec mentions canary testing for LoRA promotions but not infrastructure-level cohort routing. Add a sub-section to §11 or §17.

---

## 🟡 MEDIUM — Audit log access path is implicit

Spec mentions audit logs everywhere but doesn't specify:
- Who can see them?
- Tamper-evidence (append-only? signed?)
- Retention vs the rest of the data
- Whether audit log of recording access is itself auditable

For SOC 2 / HIPAA work this gets asked early. Add §14.x or §18.x explicitly.

---

## 🟡 MEDIUM — Agent state machine has no "EMERGENCY" or "INVALID"

Eight states listed (§9, §16). Missing:
- **EMERGENCY** — agent panic-button event (sound alert + auto-transfer)
- **NETWORK_DEGRADED** — WebRTC quality dropped below threshold, agent continues but pacing engine should slow them
- **INVALID** / **STUCK** — supervisor override for agents who appear to be stuck (e.g. paused 3hr, browser frozen)

These are operational realities; design the state machine for them now.

---

## 🟢 LOW — Pricing model placeholder needs defense

§1 says _"Per-AI-agent runtime fees (separate from human agent count)."_ This is reasonable but spec doesn't address: do you charge per worker, per master, per concurrent AI call, or per minute of AI talk-time? Each pricing model has different unit-economics implications. Decide before the marketing site goes up.

---

## 🟢 LOW — Phase 0 timeline is suspect

8 weeks for "Foundations" including cluster provisioning + auth + multi-tenancy + audit + admin GUI shell. That's a lot. With a small team it's likely 12–16 weeks. Spec doesn't anchor team size. Either pad the estimate or note "assumes N engineers full-time."

---

## 🟢 LOW — `mod_verto` is OK, but consider SIP over WSS

§4 uses `mod_verto` for WebRTC. `verto` is fine but adoption has plateaued; pure SIP-over-WebSocket-Secure (SIPjs / JsSIP) is more standard and easier to debug with stock SIP tooling. Worth a one-line comparison ADR before locking in verto.

---

## Summary table

| # | Severity | Topic | Action |
|---|----------|-------|--------|
| 1 | 🔴 | Tenant isolation vs `.dkb` portability | Decide scope (tenant-scoped vs cross-tenant) |
| 2 | 🔴 | AI capacity math doesn't work CPU-only | Walk back claim or make GPU standard |
| 3 | 🔴 | Inbound DNC + outbound callback gap | Add re-consent flow |
| 4 | 🟠 | Recording encryption forecloses enterprise | Plan two-tier encryption story |
| 5 | 🟠 | Three hook languages = 3× sandbox cost | Pick Python only |
| 6 | 🟠 | "Cold transfer" mode | Drop from v1 |
| 7 | 🟠 | FCC 3% abandon rate underspecified | Define window + measurement |
| 8 | 🟠 | Supervisor weight = 10× | Use staged DPO instead |
| 9 | 🟡 | 3 backend langs is team tax | Pick Node or Go for control plane |
| 10 | 🟡 | `.dkb` size estimate optimistic | Add compact + full tiers |
| 11 | 🟡 | Migration GUI undersells dialplan complexity | Add Python fallback |
| 12 | 🟡 | No tenant cohort/sandbox story | Spec it |
| 13 | 🟡 | Audit log access not specified | Add to §14/§18 |
| 14 | 🟡 | Agent state machine missing emergency/degraded | Add states |
| 15 | 🟢 | AI pricing model undefined | Pick a unit |
| 16 | 🟢 | Phase 0 timeline aggressive | Anchor to team size |
| 17 | 🟢 | `mod_verto` vs WSS-SIP | One-line ADR |

The four blockers should be resolved before locking the spec. Everything else can iterate during build phases.
