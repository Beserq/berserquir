# Berserqir Harness — Bootstrap

<!-- Compiled by Berserqir. DO NOT EDIT — edit canonical sources and recompile. -->

This repository runs the **Berserqir** agent harness. Before any non-trivial action, load the execution discipline:

1. `.berserqir/protocols/agentic-loop.md` — 7-phase loop, skip rules, fast-path, ALIGN schema
2. `.berserqir/protocols/memory-sync.md` — read before acting, write after acting
3. `.berserqir/protocols/context-budget.md` — what to load per phase
4. `.berserqir/protocols/mentorship.md` — calibrate pedagogy to the human's per-area proficiency (`.berserqir/memory/human-profile.md`): teach novices, accelerate experts. Guardrails never change with mode.

## Governance hierarchy (conflict resolution — top wins)

1. `.berserqir/memory/memory-long.md` + active ADRs — the constitution
2. `PRD.md` — requirements
3. `SPECS.md` — architecture (+ `DESIGN.md` — visual truth, when the front area is installed)
4. `.berserqir/memory/memory-medium.json` — sprint state
5. Skills (`.github/skills/`), then instructions

Contradiction between levels → stop and escalate. Never pick silently.

## Memory

Lives in `.berserqir/memory/`: `memory-long.md` (constitution) · `memory-medium.json` (sprint) · `memory-short.md` (session journal) · `codemap.md` (repo map — read this FIRST when navigating) · `instincts.json` (learned project patterns — load active ≥ 0.7, cap 6, per `.berserqir/protocols/instincts.md`). Missing? Run `/init`.

## Commands

`/berserqir <command>` is the hub: `init` · `compress` · `learn` · `evolve` · `evals` · `review` · `checkpoint` · `status` · `help`. Dedicated slash commands (`/init`, `/compress`, `/learn`, `/evolve`, `/run-evals`, `/code-review`) are equivalent.

## Agent roster

{{ROSTER}}

Delegation flows through `orchestrator` (never implements). Reports follow `.berserqir/protocols/sub-agent-report.md` — no valid report, no accepted work.

## Safety (non-negotiable)

Guardrail scripts in `.berserqir/hooks/`: **git-safety** (no push/force/no-verify/reset --hard without explicit human authorization) · **secret-scan** · **config-protection** (fix the code, not the ruler) · **memory-validate**. Never bypass them; overrides are human-set env vars only.
