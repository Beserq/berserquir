#!/usr/bin/env node
// Berserqir → Cursor hook adapter (DRY pattern: normalize the Cursor hooks
// payload, delegate to canonical zero-deps hooks). Vendored to .berserqir/hooks/.
//
// Wired via .cursor/hooks.json. Cursor hooks speak JSON over stdio:
//   before-shell  beforeShellExecution → git-safety   → {"permission":"deny"|"allow"} (real block)
//   after-edit    afterFileEdit        → config-protection + memory-validate + journal (observational — violations surface as agentMessage)
//   stop          stop                 → memory staleness warning (observational)
//
// Defensive: unknown payload shapes → allow silently (never break the harness).

import { readFileSync, existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOKS_DIR = dirname(fileURLToPath(import.meta.url)) // .berserqir/hooks
const MEMORY_DIR =
  process.env.BERSERQIR_MEMORY_DIR || join(HOOKS_DIR, '..', 'memory')
const mode = process.argv[2] ?? ''

let evt = {}
try {
  evt = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  /* tolerant */
}

const run = (cmd, args, env) =>
  spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env } })
const reply = (obj) => {
  console.log(JSON.stringify(obj))
  process.exit(0)
}

if (mode === 'before-shell') {
  const command = evt.command ?? evt.tool_input?.command ?? ''
  if (!command) reply({ permission: 'allow' })
  const r = run(process.execPath, [
    join(HOOKS_DIR, 'git-safety/git-safety.mjs'),
    command,
  ])
  if (r.status === 2)
    reply({
      permission: 'deny',
      userMessage: 'Berserqir git-safety blocked this command.',
      agentMessage: (r.stderr ?? '').trim(),
    })
  reply({ permission: 'allow' })
}

if (mode === 'after-edit') {
  const p = evt.file_path ?? evt.filePath ?? evt.path ?? ''
  if (!p) process.exit(0)
  let violation = ''
  const cp = run(process.execPath, [
    join(HOOKS_DIR, 'config-protection/config-protection.mjs'),
    p,
  ])
  if (cp.status === 2) violation += cp.stderr ?? ''
  const mv = run(process.execPath, [
    join(HOOKS_DIR, 'memory-validate/memory-validate.mjs'),
    p,
  ])
  if (mv.status === 2) violation += mv.stderr ?? ''
  // deterministic journal (best-effort; stderr carries compress/evolve nudges)
  const journal = join(HOOKS_DIR, 'memory-journal/memory-journal.mjs')
  if (existsSync(journal)) {
    const j = run(
      process.execPath,
      [journal, evt.agent ?? 'cursor', 'edit', p],
      { BERSERQIR_MEMORY_DIR: MEMORY_DIR },
    )
    if (j.stderr) violation += j.stderr
  }
  // update nudge (best-effort, throttled to once/day inside the hook)
  const upd = join(HOOKS_DIR, 'update-check/update-check.mjs')
  if (existsSync(upd)) {
    const u = run(process.execPath, [upd])
    if (u.stderr) violation += u.stderr
  }
  if (violation.trim()) reply({ agentMessage: violation.trim() })
  process.exit(0)
}

if (mode === 'stop') {
  const shortPath = join(MEMORY_DIR, 'memory-short.md')
  if (!existsSync(shortPath)) process.exit(0)
  const ageMinutes = (Date.now() - statSync(shortPath).mtimeMs) / 60000
  if (ageMinutes > 120)
    reply({
      agentMessage:
        '[berserqir] memory-short.md was not touched this session — run the memory-sync write step (§Focus, §Open threads, §Errors & learnings) before finishing.',
    })
  process.exit(0)
}

process.exit(0)
