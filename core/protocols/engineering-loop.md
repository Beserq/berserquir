# Protocol: Engineering Loop (bounded autonomy)

The continuous driver over the per-task agentic loop: pick next → run the cycle → gate → checkpoint → repeat. **The human stops being the operator and becomes the reviewer of a queue.** Autonomy is bounded — this protocol defines exactly where it ends.

## Preconditions (checked before iteration 1 — any failure aborts the sprint)

1. Memory installed and seeded (`/init` done) · `memory-medium.json` has features with status `planned` or `in-progress`.
2. Working tree clean (uncommitted human work is never mixed into sprint commits).
3. Project test suite green (if one exists) — never start a sprint on red.

## Iteration cycle

1. **Pick next**: highest-priority non-`blocked` feature from `memory-medium.json` (order: `in-progress` first, then `planned` by priority/RICE if present). A **scope filter** (`/sprint <n> <FEAT-anchor | area>`) restricts picking to matching features — this is what makes parallel sprints in separate worktrees safe (each session works its own slice; without a filter, two sessions would pick the same top feature).
2. **Route** per the agentic loop: classify tier, delegate, gates verify (Sub-Agent Report required).
3. **Gate**: QA verifies against the feature's acceptance criteria. Reject → one re-delegation with the rejection reason; second rejection → mark feature `blocked`, queue it, move on.
4. **Checkpoint**: memory-sync write step + **local conventional commit** (anchored: `feat(scope): … [FEAT-…]`). Committing is allowed — it creates atomic rollback points. **Pushing is not.**
5. Check stop conditions → next iteration.

## The escalation queue (what makes this safe)

Anything requiring an ALIGN (architectural ambiguity, spec conflict, scope doubt) does **not** stop the sprint and is **never decided autonomously**: the feature is marked `blocked`, the ALIGN block is appended to the sprint report's **decision queue**, and the loop moves to the next feature. The human reviews the queue in batch at the end.

## Parallel-sprint hint (propose → human OK → prepare; never silent)

At plan announcement, when the backlog holds **≥2 independent features** (disjoint areas/file scopes) and no scope filter was given, the orchestrator SHOULD offer the worktree split: name the independent slices and ask. On an explicit OK it MAY run `git worktree add ../<repo>-<slug> <branch>` per slice and hand back the per-window commands (`/sprint <n> <scope>` each). **Opening the sessions is always the human's move** (IDE windows are OS-level), and declining the hint just runs the normal sequential sprint — the hint is advice, never a gate.

Two tells that the gate was skipped — both are protocol violations: **proposing any action inside the announcement** ("I'll create the branch unless you object" — the announcement ends the turn; preparation starts only after the literal OK) and **offering a single shared branch for multiple features** (the split is one worktree + one branch *per slice*; a shared branch recreates the very collisions the split exists to prevent).

## Hard stop conditions (any one ends the sprint immediately)

- **N iterations reached** (default 3; explicit `/sprint <n>`, hard cap 10)
- **Guardrail fired** (git-safety, config-protection, secret-scan) — never retried, never overridden
- **Two consecutive features blocked** — the backlog probably needs the human
- **Eval smoke failure** at a checkpoint · **backlog empty** · **memory budget blown twice** (one auto-`/compress` at an iteration boundary is allowed per sprint)

## Never (identical to always — sprint mode relaxes nothing)

Push/deploy · guardrail overrides · memory-long writes · architectural decisions · starting work on a `blocked` feature · **running `/evolve`** — skill promotion always needs the human's explicit OK; evolve-ready instinct clusters detected mid-sprint go into the report as recommendations, never executed. Wave cap and quorum stay 3.

**Autonomous within the sprint** (mechanical and reversible, by design): deterministic hooks · QA gate verification · eval smoke (failure = hard stop, never ignored) · one `/compress` at an iteration boundary (archive-first — lossless) · `/learn` extraction inside it · anchored local commits. **The human is consulted exactly twice: plan announcement (start) and report + decision queue (end).**

## Sprint report (end of run)

Iterations executed · features moved (status before → after, commits created) · **decision queue** (pending ALIGNs, one per blocked feature) · eval/gate results · recommended next action. No valid report = the sprint didn't happen (same contract as sub-agent work).
