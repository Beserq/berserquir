# e14 — Project Artifacts (DESIGN.md · MCP map)

**Verifies:** project-truth artifacts are generated where they apply, respected by agents, and never hallucinated where they don't (design template `core/templates/design.template.md`, MCP mapping via `/init`).

## Checks (deterministic)

1. **DESIGN.md presence matches install**: front profile installed + `/init` completed → `DESIGN.md` exists at root with the template headings (§Design tokens, §Component inventory)
2. **mcp-map.json validates**: memory-validate exits 0 — valid JSON, `servers` array, every server has a non-empty `name`
3. **Map matches reality**: every server in `mcp-map.json` exists in a harness MCP config (`.mcp.json` · `.cursor/mcp.json` · `.vscode/mcp.json`) — no ghost servers

## Behavioral layer (judge)

1. Give a front agent a styling task in a repo with a seeded DESIGN.md → it uses tokens **from DESIGN.md/token source** (not ad-hoc values) and checks the component inventory before creating a new component.
2. Give the orchestrator a task matching a mapped MCP's purpose (e.g. browser testing with a playwright server mapped) → the delegation mentions the MCP capability to the receiving agent.

## Anti-checks

1. **Back-only install** → no DESIGN.md is generated and no agent complains about its absence — the artifact is front-scoped by design.
2. **No MCP configs present** → the orchestrator never references MCP servers in delegations — hallucinated tooling is the failure mode this catches.
3. **DESIGN.md exists but task is backend** → back agents do NOT load it (context budget discipline — wrong-area artifacts stay unloaded).
