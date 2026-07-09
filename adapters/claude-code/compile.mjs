#!/usr/bin/env node
// Berserqir → Claude Code adapter (compiler)
// Canonical sources → .claude/ (spokes) + CLAUDE.md + .berserqir/ (hub). Zero dependencies.
//
// Usage: node adapters/claude-code/compile.mjs [--root <repo>] [--out <target>] [--profiles front,back,...] [--models <path>]
//
// Rules implemented (see core/FORMAT.md):
//  - agent = archetype ⊕ overlay (overlay wins; lists replace; `never` unions; `extends` consumed)
//  - Claude Code agents/*.md frontmatter whitelist: name, description, tools, model — everything else → body sections
//  - `tools` map via tools.json and join as a comma-separated string (CC format)
//  - `model: top|mid|fast` translates via models.json (aliases: opus/sonnet/haiku — plan-safe)
//  - prompts → .claude/commands/<name>.md · skills → .claude/skills/ · instructions → .berserqir/instructions/ + CLAUDE.md table
//  - hooks are NATIVE: .claude/settings.json wires PreToolUse/PostToolUse/SessionStart/Stop/PreCompact → claude-adapter.mjs
//  - NEVER edit compiled output — edit canonical and recompile
//
// Parser/composition duplicated from adapters/copilot/compile.mjs by design (adapters are
// self-contained; extract a shared lib when the third adapter lands — rule of three).

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  cpSync,
  statSync,
} from 'node:fs'
import { join, basename, relative } from 'node:path'

// ---------- args ----------
const args = process.argv.slice(2)
const argOf = (f, d) => {
  const i = args.indexOf(f)
  return i === -1 ? d : args[i + 1]
}
const ROOT = argOf('--root', '.')
const OUT = argOf('--out', '.')
const PROFILES = (argOf('--profiles', 'front') || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s && s !== 'core')
  .flatMap((p) =>
    p === 'full' || p === 'stack' || p === 'all'
      ? ['front', 'back', 'ops', 'infra']
      : [p],
  )
  .flatMap((p) =>
    p === 'ops'
      ? ['ops/dev', 'ops/sec', 'ops/fin', 'ops/ia'].filter((s) =>
          existsSync(join(argOf('--root', '.'), 'profiles', s, 'agents')),
        )
      : [p],
  )

const MODELS_PATH =
  argOf('--models', null) || join(ROOT, 'adapters/claude-code/models.json')
const MODELS = JSON.parse(readFileSync(MODELS_PATH, 'utf8'))
const TOOLMAP = JSON.parse(
  readFileSync(join(ROOT, 'adapters/claude-code/tools.json'), 'utf8'),
)

// Claude Code closed schemas (FORMAT.md whitelists)
const AGENT_KEYS = new Set(['name', 'description', 'tools', 'model'])
const COMMAND_KEYS = new Set(['description', 'argument-hint'])
const SKILL_KEYS = new Set(['name', 'description'])

// canonical fields rendered as body sections (stable order, per FORMAT.md)
const BODY_SECTIONS = [
  ['type', 'Role Type'],
  ['tier', 'Tier'],
  ['parallelizable', 'Parallelizable'],
  ['escalates-to', 'Escalates To'],
  ['skills', 'Skills'],
  ['never', 'Scope (never touch)'],
  ['agents', 'Subagents (delegate via Task)'],
]

// ---------- tiny YAML frontmatter (flat keys + block lists + lists of flat objects) ----------
function parseDoc(raw) {
  if (!raw.startsWith('---\n')) return { meta: {}, body: raw }
  const end = raw.indexOf('\n---', 4)
  if (end === -1) return { meta: {}, body: raw }
  return {
    meta: parseYaml(raw.slice(4, end)),
    body: raw.slice(raw.indexOf('\n', end + 1) + 1),
  }
}
function parseYaml(src) {
  const meta = {}
  const lines = src.split('\n')
  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (!m) {
      i++
      continue
    }
    const key = m[1],
      rest = m[2].trim()
    if (rest !== '') {
      meta[key] = parseVal(rest)
      i++
      continue
    }
    const items = []
    i++
    while (i < lines.length && /^\s+\S/.test(lines[i])) {
      const im = lines[i].match(/^\s+-\s+(.*)$/)
      if (!im) {
        i++
        continue
      }
      const om = im[1].trim().match(/^([A-Za-z][\w-]*):\s*(.*)$/)
      if (om) {
        const obj = { [om[1]]: parseVal(om[2]) }
        i++
        while (
          i < lines.length &&
          /^\s+[A-Za-z][\w-]*:/.test(lines[i]) &&
          !/^\s+-\s/.test(lines[i])
        ) {
          const km = lines[i].trim().match(/^([A-Za-z][\w-]*):\s*(.*)$/)
          if (km) obj[km[1]] = parseVal(km[2])
          i++
        }
        items.push(obj)
      } else {
        items.push(parseVal(im[1].trim()))
        i++
      }
    }
    meta[key] = items
  }
  return meta
}
const parseVal = (v) => {
  v = v.trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^\[.*\]$/.test(v))
    return v
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  return v.replace(/^["']|["']$/g, '')
}
const q = (v) =>
  typeof v === 'string' && (/[:#"]/.test(v) || /^[*&!>|%@`\[\{]/.test(v))
    ? `"${v.replaceAll('"', '\\"')}"`
    : String(v)
function serMeta(meta) {
  const out = []
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v) && v.length === 0) continue
    if (Array.isArray(v)) {
      out.push(`${k}:`)
      for (const item of v) out.push(`  - ${item}`)
    } else out.push(`${k}: ${q(v)}`)
  }
  return out.join('\n')
}
const toArr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])

// ---------- path rewriting (canonical → installed layout) ----------
const rewritePaths = (text) =>
  text
    .replaceAll('core/protocols/', '.berserqir/protocols/')
    .replaceAll('core/templates/', '.berserqir/templates/')
    .replaceAll('core/memory/', '.berserqir/memory/')
    .replaceAll('core/hooks/', '.berserqir/hooks/')
    .replaceAll('core/evals/', '.berserqir/evals/')
    .replaceAll('core/skills-resources/', '.berserqir/skills-resources/')
    .replaceAll('core/skills/', '.claude/skills/')
    .replace(/core\/prompts\/([\w-]+)\.prompt\.md/g, '.claude/commands/$1.md')
    .replaceAll('core/prompts/', '.claude/commands/')

// ---------- load archetypes ----------
const archetypes = {}
for (const f of readdirSync(join(ROOT, 'core/agents')).filter((f) =>
  f.endsWith('.md'),
)) {
  const doc = parseDoc(readFileSync(join(ROOT, 'core/agents', f), 'utf8'))
  archetypes[doc.meta.name ?? basename(f, '.md')] = doc
}

// ---------- agent compilation ----------
const roster = []
function compileAgent(doc, source, profile = null) {
  let meta = { ...doc.meta }
  const bodies = []
  if (meta.extends) {
    const arch = archetypes[meta.extends]
    if (!arch) throw new Error(`${source}: unknown archetype "${meta.extends}"`)
    const never = [
      ...new Set([...toArr(arch.meta.never), ...toArr(meta.never)]),
    ]
    meta = { ...arch.meta, ...meta } // overlay wins (lists replace)
    if (never.length) meta.never = never // except `never`: union
    delete meta.extends
    bodies.push(arch.body.trim())
  }
  bodies.push(doc.body.trim())

  substituteRefs(meta)
  if (meta.name === 'orchestrator') {
    const all = overlayDocs.map((o) => o.doc.meta.name)
    meta.agents = [...new Set([...toArr(meta.agents), ...all])]
  }

  roster.push({
    name: meta.name,
    type: meta.type ?? '—',
    tier: meta.tier ?? '—',
    description: meta.description ?? '',
  })

  // tools: canonical capability → CC tool names, comma-joined (CC frontmatter format)
  if (Array.isArray(meta.tools))
    meta.tools = [
      ...new Set(meta.tools.flatMap((t) => TOOLMAP[t] ?? [t])),
    ].join(', ')
  // model resolution: agent override > profile×class > class > omit (inherit — plan-safe)
  const resolved =
    MODELS.overrides?.[meta.name] ||
    (profile && MODELS.profiles?.[profile]?.[meta.model]) ||
    MODELS[meta.model] ||
    ''
  if (resolved) meta.model = resolved
  else delete meta.model

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
  // handoffs are Copilot-native — degrade to a body section (FORMAT.md)
  if (Array.isArray(extra.handoffs) && extra.handoffs.length)
    sections +=
      `\n## Handoffs & Escalation\n\n` +
      extra.handoffs
        .map(
          (h) =>
            `- **${h.label ?? h.agent}** → \`${h.agent}\`${h.prompt ? ` — "${h.prompt}"` : ''}`,
        )
        .join('\n') +
      '\n'
  if (extra['disable-model-invocation'])
    sections += `\n## Invocation\n\nNever auto-invoked by other agents' model calls — entry point is the human (or explicit delegation).\n`

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
const write = (rel, content) => {
  const p = join(OUT, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, content)
  emitted.push(rel)
}
const emitted = []

// 1) agents — parse overlays FIRST to build the tier map
const overlayDocs = []
const tierMap = {}
for (const prof of PROFILES) {
  const dir = join(ROOT, 'profiles', prof, 'agents')
  if (!existsSync(dir)) {
    console.error(
      `[berserqir:claude-code] error: unknown profile "${prof}" (no ${relative(process.cwd(), dir)})`,
    )
    process.exit(1)
  }
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const doc = parseDoc(readFileSync(join(dir, f), 'utf8'))
    overlayDocs.push({ doc, prof, src: `profiles/${prof}/agents/${f}` })
    const tier = doc.meta.tier ?? archetypes[doc.meta.extends]?.meta.tier
    if (tier) (tierMap[tier] ??= []).push(doc.meta.name)
  }
}
function substituteRefs(meta) {
  if (Array.isArray(meta.agents))
    meta.agents = meta.agents.flatMap((n) =>
      tierMap[n]?.length ? tierMap[n] : [n],
    )
  if (Array.isArray(meta.handoffs) && typeof meta.handoffs[0] === 'object')
    meta.handoffs = meta.handoffs.flatMap((h) => {
      const subs = tierMap[h.agent]
      if (!subs?.length) return [h]
      return subs.length === 1
        ? [{ ...h, agent: subs[0] }]
        : subs.map((s) => ({ ...h, agent: s, label: `${h.label} — ${s}` }))
    })
}

for (const [name, doc] of Object.entries(archetypes)) {
  if (tierMap[name]?.length) continue
  const { content } = compileAgent(
    { meta: { ...doc.meta }, body: doc.body },
    `core/agents/${name}.md`,
  )
  write(`.claude/agents/${name}.md`, content)
}
for (const { doc, prof, src } of overlayDocs) {
  const { name, content } = compileAgent(doc, src, prof)
  write(`.claude/agents/${name}.md`, content)
}

// 2) prompts → commands (command name = filename)
for (const f of readdirSync(join(ROOT, 'core/prompts')).filter((f) =>
  f.endsWith('.prompt.md'),
)) {
  const doc = parseDoc(readFileSync(join(ROOT, 'core/prompts', f), 'utf8'))
  const fm = {}
  for (const [k, v] of Object.entries(doc.meta))
    if (COMMAND_KEYS.has(k)) fm[k] = v
  let body = rewritePaths(doc.body.trim())
  if (doc.meta.agent)
    body = `> Hosted by the **${doc.meta.agent}** role — adopt its discipline for this workflow.\n\n${body}`
  write(
    `.claude/commands/${f.replace('.prompt.md', '.md')}`,
    `---\n${serMeta(fm)}\n---\n\n${body}\n`,
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
      `.claude/skills/${id}/SKILL.md`,
      `---\n${serMeta(fm)}\n---\n\n${rewritePaths(doc.body.trim())}\n`,
    )
  }
}

// 3b) instructions: CC has no glob-scoped instruction files — vendor to the hub
// and surface an applyTo table in CLAUDE.md (agent applies them by discipline)
const instrRows = []
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
    write(
      `.berserqir/instructions/${f}`,
      `---\ndescription: ${q(doc.meta.description ?? '')}\napplyTo: ${q(doc.meta.applyTo ?? '**')}\n---\n\n${rewritePaths(doc.body.trim())}\n`,
    )
    instrRows.push(
      `| \`${doc.meta.applyTo ?? '**'}\` | \`.berserqir/instructions/${f}\` |`,
    )
  }
}

// 4) vendor the hub (.berserqir/) with path rewriting inside .md files
for (const [src, dst] of [
  ['core/protocols', '.berserqir/protocols'],
  ['core/templates', '.berserqir/templates'],
  ['core/memory/templates', '.berserqir/memory/templates'],
  ['core/memory/schemas', '.berserqir/memory/schemas'],
  ['core/hooks', '.berserqir/hooks'],
  ['core/evals', '.berserqir/evals'],
  ['core/skills-resources', '.berserqir/skills-resources'],
]) {
  const from = join(ROOT, src)
  if (!existsSync(from)) continue
  cpSync(from, join(OUT, dst), { recursive: true })
  for (const f of walk(join(OUT, dst))) {
    if (f.endsWith('.md') || f.endsWith('.mjs'))
      writeFileSync(f, rewritePaths(readFileSync(f, 'utf8')))
    emitted.push(relative(OUT, f))
  }
}
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

// 4b) hooks wiring: NATIVE Claude Code hooks (.claude/settings.json) + payload adapter
cpSync(
  join(ROOT, 'adapters/claude-code/hook-adapter.mjs'),
  join(OUT, '.berserqir/hooks/claude-adapter.mjs'),
)
emitted.push('.berserqir/hooks/claude-adapter.mjs')
const adapterCmd = (m) => `node .berserqir/hooks/claude-adapter.mjs ${m}` // relative to project root (hook cwd) — no shell-specific env syntax, Windows-safe
const hookEntry = (m) => [
  { hooks: [{ type: 'command', command: adapterCmd(m), timeout: 15 }] },
]
write(
  '.claude/settings.json',
  JSON.stringify(
    {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: adapterCmd('pre-bash'), timeout: 15 },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: 'Edit|Write|MultiEdit|NotebookEdit',
            hooks: [
              {
                type: 'command',
                command: adapterCmd('post-edit'),
                timeout: 15,
              },
            ],
          },
        ],
        SessionStart: hookEntry('session-start'),
        Stop: hookEntry('stop'),
        PreCompact: hookEntry('pre-compact'),
      },
    },
    null,
    2,
  ) + '\n',
)

// 4c) model config vendored into the hub (same /init question-8 cycle as Copilot)
write('.berserqir/models.json', JSON.stringify(MODELS, null, 2) + '\n')
write(
  '.berserqir/affinities.json',
  readFileSync(join(ROOT, 'adapters/copilot/affinities.json'), 'utf8'), // affinity data is harness-agnostic — single source
)

// 5) CLAUDE.md + AGENTS.md (roster + instructions tables injected)
const rosterMd = [
  '| Agent | Type | Tier | Description |',
  '|---|---|---|---|',
  ...roster.map(
    (r) => `| ${r.name} | ${r.type} | ${r.tier} | ${r.description} |`,
  ),
].join('\n')
const instrMd = instrRows.length
  ? ['| When editing | Load first |', '|---|---|', ...instrRows].join('\n')
  : '_No area instructions installed (core-only)._'
write(
  'CLAUDE.md',
  rewritePaths(
    readFileSync(
      join(ROOT, 'adapters/claude-code/claude-md.template.md'),
      'utf8',
    )
      .replaceAll('{{ROSTER}}', rosterMd)
      .replaceAll('{{INSTRUCTIONS}}', instrMd),
  ),
)
write(
  'AGENTS.md',
  rewritePaths(
    readFileSync(join(ROOT, 'adapters/copilot/agents-md.template.md'), 'utf8') // universal fallback — single source
      .replaceAll('{{ROSTER}}', rosterMd),
  ),
)

// 6) manifest
const fileCount = new Set(emitted).size + 1
write(
  '.berserqir/manifest.json',
  JSON.stringify(
    {
      harness: 'claude-code',
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
  `[berserqir:claude-code] compiled ${roster.length} agents, ${fileCount} files → ${OUT}`,
)
console.log(`  profiles: ${PROFILES.join(', ') || '(core only)'}`)
console.log(
  `  hooks: NATIVE via .claude/settings.json → .berserqir/hooks/claude-adapter.mjs (pre-bash git-safety · post-edit guardrails · session-start memory+instincts · stop memory check · pre-compact archive)`,
)
