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
5. Skills (`.cursor/skills/`), then area rules (`.cursor/rules/`)

Contradiction between levels → stop and escalate. Never pick silently.

## Memory

Lives in `.berserqir/memory/`: `memory-long.md` (constitution) · `memory-medium.json` (sprint) · `memory-short.md` (session journal) · `codemap.md` (repo map — read this FIRST when navigating) · `instincts.json` (learned project patterns — load `active` ≥ 0.7, cap 6, per `.berserqir/protocols/instincts.md`, at the start of every task) · `human-profile.md` (proficiency map — load the profile card at task start: §Areas filled rows + last override; it calibrates depth in every mode, from teach-first to full-speed). Missing? Run `/berserqir init`.

## Commands

`/berserqir <command>` is the hub: `init` · `compress` · `learn` · `evolve` · `sprint` · `evals` · `review` · `checkpoint` · `status` · `help`. Project commands (`/init`, `/compress`, `/learn`, `/evolve`, `/sprint`, `/run-evals`, `/code-review`) are equivalent.

## Agent roster

{{ROSTER}}

Agents are installed under `.cursor/agents/` with the `bq-` prefix. Delegation flows through `bq-orchestrator` (never implements). Reports follow `.berserqir/protocols/sub-agent-report.md` — no valid report, no accepted work.

## Safety (non-negotiable)

Guardrail scripts in `.berserqir/hooks/` are wired via `.cursor/hooks.json`: **git-safety** (beforeShellExecution — no push/force/no-verify/reset --hard without explicit human authorization; the hook DENIES) · **config-protection** + **memory-validate** + journal (afterFileEdit — fix the code, not the ruler). Never bypass them; overrides are human-set env vars only.
