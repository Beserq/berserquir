#!/usr/bin/env node
// Berserqir → GitHub Copilot adapter (compiler)
// Canonical sources → .github/ (spokes) + .berserqir/ (hub). Zero dependencies.
//
// Usage: node adapters/copilot/compile.mjs [--root <repo>] [--out <target>] [--profiles front,back,...]
//
// Rules implemented (see core/FORMAT.md):
//  - agent = archetype ⊕ overlay (overlay wins; lists replace; `never` unions; `extends` consumed)
//  - Copilot .agent.md frontmatter is a CLOSED schema — unsupported fields render as body sections
//  - `model: top|mid|fast` translates via models.json
//  - body path references rewritten: core/* → .berserqir/* or .github/*
//  - NEVER edit compiled output — edit canonical and recompile

import { readFileSync, readdirSync, existsSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseArgs,
  parseDoc,
  serMeta,
  toArr,
  makeRewritePaths,
  loadArchetypes,
  loadOverlays,
  makeSubstituteRefs,
  composeAgent,
  resolveModel,
  makeWriter,
  vendorHub,
} from '../shared/compile-lib.mjs'

// ---------- args ----------
const { argOf, ROOT, OUT, PROFILES } = parseArgs(process.argv)

const MODELS_PATH =
  argOf('--models', null) || join(ROOT, 'adapters/copilot/models.json')
const MODELS = JSON.parse(readFileSync(MODELS_PATH, 'utf8'))
const TOOLMAP = JSON.parse(
  readFileSync(join(ROOT, 'adapters/copilot/tools.json'), 'utf8'),
)

// Copilot closed schemas
const AGENT_KEYS = new Set([
  'name',
  'description',
  'model',
  'tools',
  'agents',
  'handoffs',
  'user-invocable',
  'disable-model-invocation',
  'target',
  'github',
  'argument-hint',
])
const PROMPT_KEYS = new Set([
  'description',
  'agent',
  'model',
  'tools',
  'argument-hint',
])
const SKILL_KEYS = new Set(['name', 'description'])

// canonical fields rendered as body sections (stable order, per FORMAT.md)
const BODY_SECTIONS = [
  ['type', 'Role Type'],
  ['tier', 'Tier'],
  ['parallelizable', 'Parallelizable'],
  ['escalates-to', 'Escalates To'],
  ['skills', 'Skills'],
  ['never', 'Scope (never touch)'],
]

// ---------- shared machine (adapters/shared/compile-lib.mjs) ----------
const rewritePaths = makeRewritePaths([
  ['core/skills/', '.github/skills/'],
  ['core/prompts/', '.github/prompts/'],
])
const archetypes = loadArchetypes(ROOT)

// ---------- agent compilation ----------
const roster = []
function compileAgent(doc, source, profile = null) {
  const { meta, bodies } = composeAgent(doc, archetypes, source)

  substituteRefs(meta) // generic execution refs → area squad (no-op when no overlays cover the tier)
  if (meta.name === 'orchestrator') {
    // orchestrator can route to the ENTIRE installed squad (incl. specialists)
    const all = overlayDocs.map((o) => o.doc.meta.name)
    meta.agents = [...new Set([...toArr(meta.agents), ...all])]
  }

  roster.push({
    name: meta.name,
    type: meta.type ?? '—',
    tier: meta.tier ?? '—',
    description: meta.description ?? '',
  })

  if (Array.isArray(meta.tools))
    if (Array.isArray(meta.tools))
      meta.tools = meta.tools.map((t) => TOOLMAP[t] ?? t)
  // model resolution: agent override > profile×class > class > omit (harness default — free-plan safe)
  resolveModel(MODELS, meta, profile)

  const fm = {},
    extra = {}
  for (const [k, v] of Object.entries(meta))
    (AGENT_KEYS.has(k) ? fm : extra)[k] = v

  let sections = ''
  for (const [key, title] of BODY_SECTIONS) {
    if (!(key in extra)) continue
    const v = extra[key]
    sections += `\n## ${title}\n\n${Array.isArray(v) ? v.map((x) => `- ${x}`).join('\n') : String(v)}\n`
  }

  const content =
    `---\n${serMeta(fm)}\n---\n\n` +
    `<!-- Compiled by Berserqir from ${source}. DO NOT EDIT — edit canonical sources and recompile. -->\n` +
    sections +
    '\n' +
    bodies.join('\n\n---\n\n') +
    '\n'
  return { name: meta.name, content: rewritePaths(content) }
}

// ---------- emit helpers ----------
const { write, emitted } = makeWriter(OUT)

// 1) agents — parse overlays FIRST to build the tier map (area squads replace generic execution archetypes)
const { overlayDocs, tierMap } = loadOverlays(
  ROOT,
  PROFILES,
  archetypes,
  'copilot',
)
// rewrite generic execution references (agents lists + handoff targets) to area agents
const substituteRefs = makeSubstituteRefs(tierMap)

// core archetypes: skip generic execution tiers covered by an area squad
for (const [name, doc] of Object.entries(archetypes)) {
  if (tierMap[name]?.length) continue // covered by overlay(s)
  const { content } = compileAgent(
    { meta: { ...doc.meta }, body: doc.body },
    `core/agents/${name}.md`,
  )
  write(`.github/agents/${name}.agent.md`, content)
}
for (const { doc, prof, src } of overlayDocs) {
  const { name, content } = compileAgent(doc, src, prof)
  write(`.github/agents/${name}.agent.md`, content)
}

// 2) prompts
for (const f of readdirSync(join(ROOT, 'core/prompts')).filter((f) =>
  f.endsWith('.prompt.md'),
)) {
  const doc = parseDoc(readFileSync(join(ROOT, 'core/prompts', f), 'utf8'))
  const fm = {}
  for (const [k, v] of Object.entries(doc.meta))
    if (PROMPT_KEYS.has(k)) fm[k] = v
  write(
    `.github/prompts/${f}`,
    `---\n${serMeta(fm)}\n---\n\n${rewritePaths(doc.body.trim())}\n`,
  )
}

// 3) skills: core + selected profiles
const skillDirs = [
  ['core/skills', null],
  ...PROFILES.map((p) => [`profiles/${p}/skills`, p]),
]
for (const [dirRel] of skillDirs) {
  const dir = join(ROOT, dirRel)
  if (!existsSync(dir)) continue
  for (const id of readdirSync(dir)) {
    const p = join(dir, id, 'SKILL.md')
    if (!existsSync(p)) continue
    const doc = parseDoc(readFileSync(p, 'utf8'))
    const fm = {}
    for (const [k, v] of Object.entries(doc.meta))
      if (SKILL_KEYS.has(k)) fm[k] = v
    write(
      `.github/skills/${id}/SKILL.md`,
      `---\n${serMeta(fm)}\n---\n\n${rewritePaths(doc.body.trim())}\n`,
    )
  }
}

// 3b) instructions: core + selected profiles → .github/instructions/ (applyTo preserved)
const INSTR_KEYS = new Set(['description', 'applyTo'])
const instrDirs = [
  'core/instructions',
  ...PROFILES.map((p) => `profiles/${p}/instructions`),
]
for (const dirRel of instrDirs) {
  const dir = join(ROOT, dirRel)
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir).filter((f) =>
    f.endsWith('.instructions.md'),
  )) {
    const doc = parseDoc(readFileSync(join(dir, f), 'utf8'))
    const fm = {}
    for (const [k, v] of Object.entries(doc.meta))
      if (INSTR_KEYS.has(k)) fm[k] = v
    write(
      `.github/instructions/${f}`,
      `---\n${serMeta(fm)}\n---\n\n${rewritePaths(doc.body.trim())}\n`,
    )
  }
}

// 4) vendor the hub (.berserqir/) with path rewriting inside .md files
vendorHub(ROOT, OUT, rewritePaths, emitted)

// 4b) hooks wiring: Copilot hooks JSON (schema verified against Setup 1) + payload adapter
cpSync(
  join(ROOT, 'adapters/copilot/hook-adapter.mjs'),
  join(OUT, '.berserqir/hooks/copilot-adapter.mjs'),
)
emitted.push('.berserqir/hooks/copilot-adapter.mjs')
// 4c) model config vendored into the hub — /init question 8 reads affinities and
// writes models; installer feeds .berserqir/models.json back into recompiles
write('.berserqir/models.json', JSON.stringify(MODELS, null, 2) + '\n')
write(
  '.berserqir/affinities.json',
  readFileSync(join(ROOT, 'adapters/copilot/affinities.json'), 'utf8'),
)
write(
  '.github/hooks/berserqir.json',
  JSON.stringify(
    {
      version: 1,
      hooks: {
        postToolUse: [
          {
            type: 'command',
            matcher: 'edit|create|apply_patch',
            bash: `node .berserqir/hooks/copilot-adapter.mjs`, // relative to workspace root — no command substitution, Windows-safe
            timeoutSec: 10,
          },
        ],
      },
    },
    null,
    2,
  ) + '\n',
)

// 5) copilot-instructions.md + AGENTS.md (roster injected)
const rosterMd = [
  '| Agent | Type | Tier | Description |',
  '|---|---|---|---|',
  ...roster.map(
    (r) => `| ${r.name} | ${r.type} | ${r.tier} | ${r.description} |`,
  ),
].join('\n')
for (const [tpl, dest] of [
  ['copilot-instructions.template.md', '.github/copilot-instructions.md'],
  ['agents-md.template.md', 'AGENTS.md'],
]) {
  const t = readFileSync(join(ROOT, 'adapters/copilot', tpl), 'utf8')
  write(dest, rewritePaths(t.replaceAll('{{ROSTER}}', rosterMd)))
}

// 6) manifest
const fileCount = new Set(emitted).size + 1 // +1 = manifest itself; Set dedupes stale files from prior compiles into the same OUT
write(
  '.berserqir/manifest.json',
  JSON.stringify(
    {
      harness: 'copilot',
      version: '0.0.1',
      compiledAt: new Date().toISOString(),
      profiles: PROFILES,
      agents: roster.map((r) => r.name),
      files: fileCount,
    },
    null,
    2,
  ) + '\n',
)

console.log(
  `[berserqir:copilot] compiled ${roster.length} agents, ${fileCount} files → ${OUT}`,
)
console.log(`  profiles: ${PROFILES.join(', ') || '(core only)'}`)
console.log(
  `  hooks: wired via .github/hooks/berserqir.json → .berserqir/hooks/copilot-adapter.mjs`,
)
