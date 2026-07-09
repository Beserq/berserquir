#!/usr/bin/env node
// Berserqir → Claude Code hook adapter (DRY pattern: normalize the native hook
// payload, delegate to canonical zero-deps hooks). Vendored to .berserqir/hooks/.
//
// Wired via .claude/settings.json:
//   pre-bash       PreToolUse (matcher Bash)          → git-safety            exit 2 = deny
//   post-edit      PostToolUse (Edit|Write|...)       → config-protection + memory-validate + journal
//   session-start  SessionStart                       → stdout injects §Focus + active instincts (≥0.7, cap 6)
//   stop           Stop                               → memory untouched this session ⇒ exit 2 (once — respects stop_hook_active)
//   pre-compact    PreCompact                         → archive memory-short verbatim (deterministic half of /compress step 1)
//
// Defensive: unknown payload shapes → exit 0 silently (never break the harness).

import {
  readFileSync,
  existsSync,
  mkdirSync,
  statSync,
  copyFileSync,
} from 'node:fs'
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
  /* no/invalid stdin — hooks stay tolerant */
}

const run = (cmd, args, env) =>
  spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env } })

if (mode === 'pre-bash') {
  const command = evt.tool_input?.command ?? ''
  if (!command) process.exit(0)
  const r = run(process.execPath, [
    join(HOOKS_DIR, 'git-safety/git-safety.mjs'),
    command,
  ])
  if (r.status === 2) {
    process.stderr.write(r.stderr ?? '')
    process.exit(2)
  }
  process.exit(0)
}

if (mode === 'post-edit') {
  const p =
    evt.tool_input?.file_path ??
    evt.tool_input?.filePath ??
    evt.tool_input?.notebook_path ??
    ''
  if (!p) process.exit(0)
  let blocked = null
  const cp = run(process.execPath, [
    join(HOOKS_DIR, 'config-protection/config-protection.mjs'),
    p,
  ])
  if (cp.status === 2) blocked = cp.stderr
  const mv = run(process.execPath, [
    join(HOOKS_DIR, 'memory-validate/memory-validate.mjs'),
    p,
  ])
  if (mv.status === 2) blocked = (blocked ?? '') + mv.stderr
  // deterministic journal (best-effort, never blocks; stderr carries compress/evolve nudges)
  const journal = join(HOOKS_DIR, 'memory-journal/memory-journal.mjs')
  if (existsSync(journal)) {
    const j = run(
      process.execPath,
      [journal, evt.agent ?? 'claude', evt.tool_name ?? 'Edit', p],
      { BERSERQIR_MEMORY_DIR: MEMORY_DIR },
    )
    if (j.stderr) process.stderr.write(j.stderr)
  }
  // update nudge (best-effort, throttled to once/day inside the hook)
  const upd = join(HOOKS_DIR, 'update-check/update-check.mjs')
  if (existsSync(upd)) {
    const u = run(process.execPath, [upd])
    if (u.stderr) process.stderr.write(u.stderr)
  }
  if (blocked) {
    process.stderr.write(blocked)
    process.exit(2)
  }
  process.exit(0)
}

if (mode === 'session-start') {
  const out = []
  const shortPath = join(MEMORY_DIR, 'memory-short.md')
  if (existsSync(shortPath)) {
    const focus = readFileSync(shortPath, 'utf8')
      .match(/## Focus\n([\s\S]*?)(?=\n## |$)/)?.[1]
      ?.replace(/<!--[\s\S]*?-->/g, '')
      .trim()
    if (focus) out.push(`## Session context (memory-short §Focus)\n${focus}`)
  }
  const instPath = join(MEMORY_DIR, 'instincts.json')
  if (existsSync(instPath)) {
    try {
      const active = (
        JSON.parse(readFileSync(instPath, 'utf8')).instincts ?? []
      )
        .filter((i) => i.status === 'active' && i.confidence >= 0.7)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 6) // injection cap — core/protocols/instincts.md
      if (active.length)
        out.push(
          `## Active instincts (learned project patterns)\n` +
            active
              .map((i) => `- [${i.scope}] ${i.statement} (${i.confidence})`)
              .join('\n'),
        )
    } catch {
      /* malformed instincts.json is memory-validate's job */
    }
  }
  // update available? (reads local cache only — zero network in the hot path)
  const upd = join(HOOKS_DIR, 'update-check/update-check.mjs')
  if (existsSync(upd)) {
    const u = run(process.execPath, [upd, '--print'])
    if (u.stdout?.trim()) out.push(u.stdout.trim())
  }
  if (out.length) {
    out.push(
      'Follow `.berserqir/protocols/memory-sync.md`: read before acting, write after acting.',
    )
    console.log(out.join('\n\n')) // SessionStart stdout is injected as context
  }
  process.exit(0)
}

if (mode === 'stop') {
  if (evt.stop_hook_active) process.exit(0) // never loop
  const shortPath = join(MEMORY_DIR, 'memory-short.md')
  if (!existsSync(shortPath)) process.exit(0) // not seeded — /init's job, not ours
  const ageMinutes = (Date.now() - statSync(shortPath).mtimeMs) / 60000
  if (ageMinutes > 120) {
    process.stderr.write(
      '[berserqir] memory-short.md was not touched this session — run the memory-sync write step (§Focus, §Open threads, §Errors & learnings), or state explicitly that nothing needs recording, then finish.\n',
    )
    process.exit(2) // block stop once; retry carries stop_hook_active
  }
  process.exit(0)
}

if (mode === 'pre-compact') {
  const shortPath = join(MEMORY_DIR, 'memory-short.md')
  if (!existsSync(shortPath)) process.exit(0)
  const dir = join(MEMORY_DIR, 'compressions')
  mkdirSync(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(shortPath, join(dir, `${ts}-precompact.md`))
  console.log(
    `[berserqir] memory-short.md archived to .berserqir/memory/compressions/${ts}-precompact.md — after compaction, reload per .berserqir/protocols/memory-sync.md §Recovery`,
  )
  process.exit(0)
}

process.exit(0)
