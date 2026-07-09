#!/usr/bin/env node
// Berserqir guardrail: memory-validate
// Post-edit validation of memory files. Zero dependencies (hand-rolled checks,
// no ajv). Exit 0 = valid · exit 2 = violation.
//
// Usage: memory-validate.mjs <path-to-edited-memory-file>

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const CHARS_PER_TOKEN = 4 // rough proxy
const SIZE_BUDGETS_TOKENS = {
  'memory-short.md': 2500,
  'memory-long.md': 4000,
  'codemap.md': 2000,
  'human-profile.md': 1500,
  'DESIGN.md': 3000,
}
const REQUIRED_HEADINGS = {
  'memory-short.md': [
    '## Focus',
    '## Journal',
    '## Errors & learnings',
    '## Open threads',
  ],
  'human-profile.md': ['## Areas', '## Override log', '## Growth notes'],
  'memory-long.md': [
    '## Project',
    '## Stack',
    '## Constraints',
    '## Conventions',
    '## Active ADR references',
  ],
  'codemap.md': ['## Modules', '## Entry points', '## Edges'],
  'DESIGN.md': [
    '## Visual identity',
    '## Design tokens',
    '## Component inventory',
  ],
}
const FEATURE_STATUS = new Set([
  'planned',
  'in-progress',
  'blocked',
  'done',
  'superseded',
])

const fail = (msg) => {
  console.error(`[berserqir:memory-validate] BLOCKED: ${msg}`)
  process.exit(2)
}

const file = process.argv[2]
if (!file) process.exit(0)
const base = basename(file)

let raw
try {
  raw = readFileSync(file, 'utf8')
} catch {
  process.exit(0) // file gone/not readable — not this hook's problem
}

if (base === 'graph.json') {
  let g
  try {
    g = JSON.parse(raw)
  } catch (e) {
    fail(`graph.json is not valid JSON (${e.message})`)
  }
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges))
    fail(`graph.json requires "nodes" and "edges" arrays`)
  const NODE_TYPES = new Set(['file', 'module', 'adr', 'feature', 'debt'])
  const EDGE_TYPES = new Set(['implements', 'depends', 'supersedes'])
  const ids = new Set()
  for (const n of g.nodes) {
    if (!n.id || !NODE_TYPES.has(n.type))
      fail(
        `graph.json node ${JSON.stringify(n.id)}: missing id or invalid type "${n.type}"`,
      )
    if (ids.has(n.id)) fail(`graph.json duplicate node id "${n.id}"`)
    ids.add(n.id)
  }
  for (const e of g.edges) {
    if (!EDGE_TYPES.has(e.type))
      fail(`graph.json edge ${e.from}→${e.to}: invalid type "${e.type}"`)
    for (const end of [e.from, e.to])
      if (!ids.has(end))
        fail(`graph.json edge references unknown node "${end}" (ghost node)`)
  }
  process.exit(0)
}

if (base === 'mcp-map.json') {
  let data
  try {
    data = JSON.parse(raw)
  } catch (e) {
    fail(`mcp-map.json is not valid JSON (${e.message})`)
  }
  if (!Array.isArray(data.servers))
    fail(`mcp-map.json requires a "servers" array`)
  for (const s of data.servers) {
    if (!s.name) fail(`mcp-map server entry missing "name"`)
    if (!s.purpose) fail(`mcp-map server "${s.name}": missing "purpose"`)
  }
  process.exit(0)
}

if (base === 'instincts.json') {
  let data
  try {
    data = JSON.parse(raw)
  } catch (e) {
    fail(`instincts.json is not valid JSON (${e.message})`)
  }
  if (!('updatedAt' in data) || !Array.isArray(data.instincts))
    fail(`instincts.json requires "updatedAt" and an "instincts" array`)
  const STATUS = new Set(['candidate', 'active', 'promoted', 'expired'])
  const seen = new Set()
  for (const i of data.instincts) {
    if (!i.id || !/^INST-[a-z0-9][a-z0-9-]*$/.test(i.id))
      fail(`instinct id "${i.id}" does not match INST-slug`)
    if (seen.has(i.id)) fail(`duplicate instinct id "${i.id}"`)
    seen.add(i.id)
    if (!i.statement) fail(`instinct ${i.id}: missing statement`)
    if (
      typeof i.confidence !== 'number' ||
      i.confidence < 0 ||
      i.confidence > 1
    )
      fail(`instinct ${i.id}: confidence must be a number in [0,1]`)
    if (!STATUS.has(i.status))
      fail(`instinct ${i.id}: invalid status "${i.status}"`)
    if (!Array.isArray(i.evidence) || i.evidence.length < 1)
      fail(
        `instinct ${i.id}: needs ≥1 evidence entry — no evidence, no instinct`,
      )
    if (i.status === 'active' && i.confidence < 0.7)
      fail(
        `instinct ${i.id}: active requires confidence ≥0.7 (has ${i.confidence})`,
      )
    if (i.status === 'promoted' && !i.promotedTo)
      fail(`instinct ${i.id}: promoted requires "promotedTo" (skill path)`)
  }
  process.exit(0)
}

if (base === 'memory-medium.json') {
  let data
  try {
    data = JSON.parse(raw)
  } catch (e) {
    fail(`memory-medium.json is not valid JSON (${e.message})`)
  }
  for (const key of ['currentMilestone', 'features', 'updatedAt'])
    if (!(key in data)) fail(`memory-medium.json missing required key "${key}"`)
  if (!Array.isArray(data.features)) fail(`"features" must be an array`)
  for (const f of data.features) {
    if (!f.id || !/^FEAT-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(f.id))
      fail(`feature id "${f.id}" does not match FEAT-YYYY-MM-DD-slug`)
    if (!FEATURE_STATUS.has(f.status))
      fail(`feature ${f.id}: invalid status "${f.status}"`)
    if (!f.owner) fail(`feature ${f.id}: missing owner`)
  }
  for (const adr of data.adrsActive ?? [])
    if (!/^ADR-\d{3,}$/.test(adr)) fail(`invalid ADR ref "${adr}"`)
  process.exit(0)
}

if (base in REQUIRED_HEADINGS) {
  for (const h of REQUIRED_HEADINGS[base])
    if (!raw.includes(h)) fail(`${base} missing required heading "${h}"`)
  const budget = SIZE_BUDGETS_TOKENS[base]
  const approxTokens = Math.round(raw.length / CHARS_PER_TOKEN)
  if (approxTokens > budget)
    fail(
      `${base} exceeds size budget: ~${approxTokens} > ${budget} tokens — run /compress`,
    )
  process.exit(0)
}

process.exit(0) // not a memory file — no-op
