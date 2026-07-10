---
name: sprint
description: Bounded-autonomy engineering loop — iterate over the sprint backlog (pick → implement → gate → checkpoint), queueing architectural decisions for the human. Hard stop conditions.
argument-hint: "[iterations — default 3, max 10]"
---

# /sprint — Engineering Loop Driver

> Hosted by the **orchestrator** role — adopt its discipline. The rules live in `core/protocols/engineering-loop.md`; nothing here relaxes them.

## Run

1. **Preconditions** (protocol §1): memory seeded · tree clean · tests green · backlog non-empty. Any failure → report which and stop; never "fix" preconditions silently.
2. **Announce the plan**: iterations to run (argument, default 3, cap 10) and the candidate features in pick order. This is the sprint's ALIGN — a one-shot confirmation unless the human configured otherwise.
3. **Iterate** per the protocol cycle: pick → route/delegate → QA gate → memory-sync + local anchored commit. Architectural ambiguity → mark `blocked`, append the ALIGN block to the decision queue, continue.
4. **Stop** on any hard condition (protocol §hard-stop) — say which one ended the run.
5. **Report** (protocol §sprint-report): features moved with commits · **decision queue for the human** · gate results · next action.

## Guardrails (non-negotiable)

- Local commits only — **never push**, never deploy, never `--force`/`--no-verify`.
- Guardrail block = sprint over. Report it; do not retry or override.
- Nothing enters memory-long. Blocked features are never resumed within the same sprint.
- **Never run `/evolve` mid-sprint** — evolve-ready clusters go into the report as recommendations; promotion waits for the human.
- If the journal suggests `/compress` mid-sprint, honor it at the next iteration boundary (once per sprint).
