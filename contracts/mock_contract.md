---
# METADATA BLOCK (Parser bóc tách không cần RAG)
BOUNTY_ID: "BTY-2026-0717-01"
TARGET_MODULE: "context_drift_auditor"
EVIDENCE_TYPE: "EXTERNAL_MARKET"
SIGNAL_SCORE: 8.5
LEVERAGE_SCORE: 9.0
PAIN_RECURRENCE: HIGH
DIFFICULTY: "MEDIUM"
ASSET_CLASS: "B2B_CORE_LICENSE"
PRIMARY_STACK: "TYPESCRIPT"
ABSTRACTION_HASH: null
PAIN_CLUSTER_ID: null
---

# EXECUTION CONTRACT: Context Drift Auditor for Long-Session LLM Agents

## [1] PAIN POINT & EVIDENTIARY TIERING

### Pain Point
LLM agents maintain adherence to system prompt and task context at session start, but exhibit **silent behavioral drift** as sessions extend past ~30 minutes or as context buffers accumulate compression artifacts. The drift is not a crash — it is a slow regression where the agent acts on stale or hallucinated context without emitting any failure signal. By the time a human notices, the agent has already committed actions on outdated assumptions.

### Sources (verified real, fetched 2026-07-17)
- **ArXiv 2510.07777** — "Drift No More? Context Equilibria in Multi-Turn LLM Interactions" — proposes a dynamical framework for context drift in multi-turn interactions.
  https://arxiv.org/abs/2510.07777
- **ArXiv 2509.01093** — "Natural Context Drift Undermines the Natural Language Understanding of Large Language Models" — formal evidence that drift degrades NLU capability.
  https://arxiv.org/abs/2509.01093
- **GitHub: langchain-ai/how_to_fix_your_context** — Drew Breunig's four failure modes: Context Poisoning, Context Reflection, Context Distraction, Context Confusion.
  https://github.com/langchain-ai/how_to_fix_your_context
- **GitHub: langfuse/langfuse #12873** — RFC: Session-boundary behavioral drift monitoring, tracking context compression effects across long-running agents.
  https://github.com/langfuse/langfuse/issues/12873
- **GitHub: sgl-project/sglang discussion 19397** — agent system prompt drift after 30+ minutes; 300-token mitigation fix proposed.
  https://github.com/sgl-project/sglang/discussions/19397

### Verification Depth
- ArXiv papers: abstract + HTML body fetched (`fetched_full_page`)
- GitHub sources: full discussion thread fetched (`fetched_full_page`)

### Failure Mechanism (where current SaaS/Cloud solutions fail)
Cloud-only observability platforms (LangSmith, Helicone, etc.) detect drift *post-hoc* via aggregated statistics — they cannot enforce *invariant rules at runtime* because they sit outside the agent's execution loop. They require network round-trips, so they cannot block a drifted action before it commits. They store conversation transcripts in vendor cloud, which violates the offline-first / data-sovereignty invariant of B2B research labs.

### Evidence Level
**BATTLE_TESTED** — multiple independent research groups and production agents report the same drift thresholds (~30 min, ~50% effective context). Pain recurrence confirmed across 5 independent sources.

## [2] STATE SPACE & MATHEMATICAL REPRESENTATION

### Input Domain
A streaming context buffer `C[t]` representing the full agent state at time `t`:
- system prompt `S` (constant)
- task specification `T` (constant or slowly evolving)
- conversation history `H[t]` (monotonically growing)
- compressed summaries `Z[t]` (introduced when `H[t]` exceeds compression threshold)
- tool-call results `R[t]` (interleaved with `H[t]`)

### State Machine
```
                  ┌─────────────────────┐
                  │  COHERENT (initial) │
                  └─────────┬───────────┘
                            │
                    H[t] grows, Z[t] accumulates
                            │
                            ▼
                  ┌─────────────────────┐
                  │  DRIFT_LATENT       │  ← drift signal present but no action yet
                  └─────────┬───────────┘
                            │
              invariant violation detected
                            │
                            ▼
                  ┌─────────────────────┐
                  │  DRIFT_ACTIVE       │  ← agent about to commit drifted action
                  └─────────┬───────────┘
                            │
                ┌───────────┴───────────┐
                │                       │
        auditor blocks          auditor allows
        (quarantine)            (false positive)
                │                       │
                ▼                       ▼
        ┌──────────────┐        ┌──────────────┐
        │  RECOVERY    │        │  COHERENT    │
        └──────────────┘        └──────────────┘
```

### Invariant Rule
For every agent action `a[t]` about to be committed, the auditor must verify:
1. **Reference integrity** — every entity referenced in `a[t]` resolves to a record in `S ∪ T ∪ H[t]` (no hallucinated references).
2. **Recency bound** — no fact in `a[t]` predates a known retraction in `H[t]`.
3. **Role preservation** — `a[t]` does not violate the role boundary defined in `S`.

If any check fails, the auditor must return `DriftError` and block `a[t]` before it commits.

### Trait Skeleton (TypeScript — Repo 1's current stack)
```typescript
// PSEUDOCODE / TRAIT SKELETON
// Implementation language: TypeScript (Electron / Repo 1).
// The interface below is portable — when Repo 1 migrates to Rust,
// it maps directly to a `trait GroundTruthAuditor` with equivalent signatures.

export interface ContextBuffer {
  systemPrompt: string;            // S
  taskSpec: string;                // T
  history: HistoryEntry[];         // H[t]
  compressedSummaries: string[];   // Z[t]
  toolResults: ToolResult[];       // R[t]
}

export interface AuditReport {
  status: 'COHERENT' | 'DRIFT_LATENT' | 'DRIFT_ACTIVE';
  violations: Violation[];
  timestamp: number;
}

export interface Violation {
  rule: 'REFERENCE_INTEGRITY' | 'RECENCY_BOUND' | 'ROLE_PRESERVATION';
  evidence: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export class DriftError extends Error {
  constructor(public violations: Violation[]) {
    super(`Drift detected: ${violations.map(v => v.rule).join(', ')}`);
  }
}

export interface GroundTruthAuditor {
  validateState(input: ContextBuffer): Promise<AuditReport>;
  // Throws DriftError if DRIFT_ACTIVE and agent action is about to commit.
  assertSafeToCommit(input: ContextBuffer): Promise<void>;
}
```

## [3] REPO 1 MULTI-LLM ORCHESTRATION (suggested role split)

When Repo 1's LLMs implement this auditor, the following division of labor is suggested (overrideable per bounty):
- **ChatGPT**: Framework & type system design — `ContextBuffer`, `AuditReport`, `Violation` interfaces.
- **Claude**: Logic implementation & edge-case review — `validateState`, `assertSafeToCommit` internals.
- **Gemini**: State space refinement — invariant discovery, threshold tuning.
- **Grok**: Compression protocol — how `Z[t]` summaries preserve invariant-relevant facts.
- **GLM**: Field scraping & log retrieval — surface evidence from internal telemetry.

## [4] MONETIZATION & MOAT

### Target Buyer
B2B research labs and independent AI agent studios running long-session agents (30+ minutes) where drift causes silent financial or research-data loss.

### Moat Strategy
**Deterministic Core Execution — Offline First.** The auditor runs inside the agent's process, blocks actions before commit, and stores no data externally. Cloud-only observability competitors cannot match this because their architecture requires the network hop.

### Leverage
Solving context drift auditing creates a reusable **representation** that applies to:
- Long-session coding agents (Cursor, Continue, Aider)
- Long-session research agents (Perplexity Pro, Elicit)
- Long-session customer support agents
- Long-session game NPC agents (where drift breaks narrative continuity)
- Any system where an LLM holds state across many turns

The same `GroundTruthAuditor` interface can be re-used across all of the above without modification — only the `ContextBuffer` shape and the invariant rules differ.

## [5] REPO 1 INJECTION INSTRUCTION

### Task
Implement the `GroundTruthAuditor` interface in TypeScript, with a default implementation that:
1. Materializes `ContextBuffer` from the agent's live state.
2. Runs the three invariant checks (`REFERENCE_INTEGRITY`, `RECENCY_BOUND`, `ROLE_PRESERVATION`).
3. Exposes both `validateState` (non-blocking, returns report) and `assertSafeToCommit` (blocking, throws on drift).
4. Ships as a standalone ES module with zero runtime dependencies (only TypeScript types).

### Constraints (invariants — must not be violated)
1. **Offline-first** — auditor must function with no network access. No telemetry calls, no remote model calls.
2. **No mutation** — `validateState` must not modify `ContextBuffer`. The auditor is read-only.
3. **Deterministic** — same `ContextBuffer` input must always produce the same `AuditReport`. No `Math.random()`, no `Date.now()` in the validation path (timestamp is set by caller, not by auditor).
4. **Fast** — must complete in <50ms per check on a 100K-token context buffer.
5. **No external state** — auditor cannot read from disk, network, or process environment during validation.

### Acceptance Signals
- [ ] Type-checks under `tsc --strict`
- [ ] Unit tests cover all 3 invariant rules with both pass and fail cases
- [ ] A long-session simulation (mocked 60-min conversation) shows the auditor catching at least 1 drift event that would otherwise have committed
