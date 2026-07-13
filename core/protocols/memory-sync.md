# Protocol: Memory Sync

Memory is hybrid by primary consumer (plan D10): Markdown where LLM/human reads and writes prose, JSON where machines parse and mutate.

| File | Format | TTL | Content |
|---|---|---|---|
| `memory-long.md` | MD | permanent | constitution: stack, constraints, conventions, active ADR refs |
| `memory-medium.json` | JSON | sprint | feature tracker: status/owner/dates, debt, counters |
| `memory-short.md` | MD | session | session journal: focus, last actions, errors, open threads |
| `instincts.json` | JSON | rolling (30d reinforcement) | learned project patterns — lifecycle in `core/protocols/instincts.md` |
| `human-profile.md` | MD | slow (person-scoped) | proficiency map — consumed by `core/protocols/mentorship.md` |

## Two layers

**Deterministic (zero LLM — hooks write it):** PostToolUse appends touched files/commands/timestamps to the journal · SessionStart injects memory-short + codemap · SessionEnd verifies memory was touched (warns if not) · PreCompact triggers compression.

**Semantic (agent writes it — the ritual below):** decisions, learnings, the "why".

## The ritual (agents)

Run at: task start · every handoff (both directions) · task end.

1. **Read before acting:** memory-short (state) + memory-medium (sprint) + memory-long §relevant (constraints) + active instincts (≥ 0.7, cap 6 — `core/protocols/instincts.md` §Injection) + the **profile card** — human-profile §Areas filled rows + last override, one line (mentorship calibration; harnesses with session hooks inject it automatically).
2. **Write after acting:** memory-short — what was done, errors hit, open threads; memory-medium — feature status/counters if a feature moved.
3. **Never write to memory-long** without an approved ADR (authority roles only).
4. Set `memorySync: true` in the Sub-Agent Report only after step 2.

## Size budgets

memory-short exceeding its size budget triggers the compression flow (`/compress` → archive to `compressions/`). Schema validation for JSON files runs as a deterministic post-edit hook.

## Recovery

Lost context (repeated searches, contradicting an ADR, re-reading the same file 3×)? Reload in order: memory-short → memory-medium → memory-long → PRD → SPECS → codemap. Then resume.
