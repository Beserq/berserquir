---
name: init
description: Bootstrap Berserqir in a project — greenfield interview or brownfield scan with block-by-block confirmation. Hosted by the product role.
agent: product
---

# /init — Project Bootstrap

**Nothing is written without explicit confirmation.** This is the ALIGN spirit applied to bootstrap: propose → confirm → write. All generated specs carry `status: draft` until human review.

## Step 0 — Detect mode

Source manifests (`package.json`, `go.mod`, `pyproject.toml`, `*.tf`, …) or a populated `src/` present → **brownfield**. Otherwise → **greenfield**. State the detection and confirm before proceeding.

## Greenfield — directed interview

Ask **one question at a time**; push for specific answers (good: "solo founders evaluating a tool on their phone between meetings" — bad: "users"):

1. **Product** — what is it, for whom, why now? (→ PRD §product/§personas)
2. **Success** — what does done/working look like in 90 days? (→ PRD §goals)
3. **Stack** — intended languages/frameworks/deploy target, or "propose one"? (→ memory-long §stack)
4. **Non-negotiables** — security/performance/a11y/style constraints that no deadline overrides (→ memory-long §constraints)
5. **Org conventions** — naming, tagging, internal policies? **These go to memory-long §conventions — never into agent definitions** (D2)
6. **Areas** — which squads apply: front / back / ops(dev·sec·fin·ia) / infra?
7. **Your proficiency** — per selected area: novice / competent / senior? Honest answers calibrate mentorship (`core/protocols/mentorship.md`) — seeds `.berserqir/memory/human-profile.md`; behavior refines it over time
8. **Model roster** — present the models available in THIS harness/plan as a list and ask per routing class (top/mid/fast), **per selected area**. Consult `.berserqir/affinities.json` and present its recommendations as advice with the `sourcedAt` date and rationale (e.g., "benchmarks favor visual-strong families for front — sourced 2026-07-08, verify if stale") — **the human decides, never auto-apply**. Notes: "skip" = harness default model (works on any plan, including free) · cross-family gates/panels reduce correlated errors · answers are written to `.berserqir/models.json` (`profiles` layer) and applied on the next `npx berserqir update` (recompiles agents with your roster)
9. **MCP servers** — scan `.mcp.json`, `.cursor/mcp.json` and `.vscode/mcp.json` for configured MCP servers. Found any? Present the list and ask, per server: what is it for, and which area(s) benefit (front/back/ops/infra/all)? Answers go to `.berserqir/memory/mcp-map.json` — the orchestrator reads it when routing. None found or "skip" → write nothing (agents must never reference unmapped MCP tools)
10. **Design system** (only if front was selected in question 6) — does the project have a visual identity: token source, type scale, component conventions? Generate `DESIGN.md` from `core/templates/design.template.md` with the answers (draft — owner: sr-front). "Not yet" → seed the skeleton anyway; front agents fill it as the system emerges

Then generate, in order, each after an OK: `PRD.md` (from `core/templates/prd.template.md`) → `SPECS.md` + `TESTS.md` skeletons → `DESIGN.md` (front installs only — from `core/templates/design.template.md`) → `memory-long.md` (constitution) → `memory-medium.json` (empty tracker) + `memory-short.md` (fresh) + `human-profile.md` (seeded) + `instincts.json` (empty, from `core/memory/templates/instincts.template.json` — the learning pipeline fills it) + `mcp-map.json` (only if MCP servers were mapped in question 9) → `codemap.md` seed + `graph.json` (from `core/memory/templates/graph.template.json` — shape enforced by `core/memory/schemas/graph.schema.json`).

## Brownfield — scan + block-by-block confirmation

**Scan first (read-only):** manifests → stack/versions · directory tree → modules · configs (lint, CI, test) → conventions · test files → frameworks/coverage · commit history (shallow) → naming patterns · structural decisions visible in code → implicit ADR candidates.

**Then present blocks, one at a time.** Format per block:

```markdown
### Block N — <topic>
- **Understood:** <finding, with file evidence>
- **Assuming:** <inference that needs validation>
Confirm, correct, or add?
```

| Block | Covers | Writes (after OK) |
|---|---|---|
| 1 | stack & versions | memory-long §stack |
| 2 | modules & structure | codemap.md + graph.json |
| 3 | conventions (naming, style, org policies) | memory-long §conventions |
| 4 | testing & CI reality | TESTS.md (draft) |
| 5 | implicit ADRs (decisions already living in the code) | SPECS §ADR registry (status: `inferred-draft`) |
| 6 | product intent (inferred from README/docs — weakest block, interview-style questions here) | PRD.md (draft) |
| 7 | design system — token sources, styles, component dirs (only if front is installed) | DESIGN.md (draft, from `core/templates/design.template.md`) |
| 8 | MCP servers — scan `.mcp.json` / `.cursor/mcp.json` / `.vscode/mcp.json`; confirm purpose + area per server | `.berserqir/memory/mcp-map.json` (skipped when none found) |

Rules: never skip a block silently · a corrected block is re-presented before writing · finish with a summary of everything written + `memory-short.md` seeded with "bootstrap complete, drafts pending review" as the open thread.
