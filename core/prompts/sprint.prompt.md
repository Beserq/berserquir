---
name: sprint
description: Bounded-autonomy engineering loop — iterate over the sprint backlog (pick → implement → gate → checkpoint), queueing architectural decisions for the human. Hard stop conditions.
argument-hint: "[iterations — default 3, max 10] [scope — optional FEAT anchor or area, for parallel worktree sessions]"
---

# /sprint — Engineering Loop Driver

> Hosted by the **orchestrator** role — adopt its discipline. The rules live in `core/protocols/engineering-loop.md`; nothing here relaxes them.

## Run

1. **Preconditions** (protocol §1): memory seeded · tree clean · tests green · backlog non-empty. Any failure → report which and stop; never "fix" preconditions silently.
2. **Announce the plan**: iterations to run (argument, default 3, cap 10) and the candidate features in pick order — honoring the **scope filter** if one was passed (`/sprint 3 FEAT-x` or `/sprint 3 front`). This is the sprint's ALIGN — a one-shot confirmation unless the human configured otherwise. **Parallel-sprint hint** (protocol §parallel-sprint-hint): if ≥2 backlog features are independent (disjoint areas/files) and no filter was given, offer the worktree split — on an explicit OK, create the worktrees/branches and hand back one `/sprint <n> <scope>` command per window; the human opens the sessions. Declined → proceed sequentially, no second ask.
3. **Iterate** per the protocol cycle: pick → route/delegate → QA gate → memory-sync + local anchored commit. Architectural ambiguity → mark `blocked`, append the ALIGN block to the decision queue, continue.
4. **Stop** on any hard condition (protocol §hard-stop) — say which one ended the run.
5. **Report** (protocol §sprint-report): features moved with commits · **decision queue for the human** · gate results · next action.

## Guardrails (non-negotiable)

- Local commits only — **never push**, never deploy, never `--force`/`--no-verify`.
- Guardrail block = sprint over. Report it; do not retry or override.
- Nothing enters memory-long. Blocked features are never resumed within the same sprint.
- **Never run `/evolve` mid-sprint** — evolve-ready clusters go into the report as recommendations; promotion waits for the human.
- If the journal suggests `/compress` mid-sprint, honor it at the next iteration boundary (once per sprint).

## Parallel sprints (worktrees — hinted, human-approved, never silent)

One sprint runs in one working tree; edit tools, hooks and memory are anchored to the opened workspace, so parallelism across trees is a multi-session move. The orchestrator **proposes** the split when it sees independent slices (see step 2), **prepares** worktrees/branches after an explicit OK, and the human opens each worktree as its own harness session. Each session runs `/sprint <n> <scope>` with its own slice — the scope filter is what prevents two sessions from picking the same feature. Expect `memory-short.md` §Journal to conflict at merge (keep both blocks or `/compress` after); merge branches via PR as usual. Within a single sprint, parallelism stays wave-cap-3 with disjoint file scopes in the same tree.
