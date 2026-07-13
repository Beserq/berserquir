#!/usr/bin/env node
// Berserqir → Claude Code hook adapter (DRY pattern: normalize the native hook
// payload, delegate to canonical zero-deps hooks). Vendored to .berserqir/hooks/.
//
// Wired via .claude/settings.json:
//   pre-bash       PreToolUse (matcher Bash)          → git-safety + cmd-safety  exit 2 = deny
//   post-edit      PostToolUse (Edit|Write|...)       → config-protection + memory-validate + journal + advisories (stray-doc, front-quality)
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

// friction trace: guard verdicts are journaled (best-effort, never block) —
// repeated denies/blocks are exactly the material /learn mines into instincts
const trace = (tool, target, outcome) => {
  const journal = join(HOOKS_DIR, 'memory-journal/memory-journal.mjs')
  if (!existsSync(journal)) return
  run(
    process.execPath,
    [journal, evt.agent ?? 'claude', tool, target, outcome],
    {
      BERSERQIR_MEMORY_DIR: MEMORY_DIR,
    },
  )
}

if (mode === 'pre-bash') {
  const command = evt.tool_input?.command ?? ''
  if (!command) process.exit(0)
  for (const guard of [
    'git-safety/git-safety.mjs',
    'cmd-safety/cmd-safety.mjs',
  ]) {
    const g = join(HOOKS_DIR, guard)
    if (!existsSync(g)) continue
    const r = run(process.execPath, [g, command])
    if (r.status === 2) {
      trace(
        'bash',
        command.split(/\s+/).slice(0, 4).join(' ').slice(0, 80),
        `deny:${guard.split('/')[0]}`,
      )
      process.stderr.write(r.stderr ?? '')
      process.exit(2)
    }
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
  // journal FIRST (best-effort, never blocks; stderr carries compress/evolve
  // nudges) — its auto-rotate archives an over-budget §Journal before
  // memory-validate gates on the same budget
  const journal = join(HOOKS_DIR, 'memory-journal/memory-journal.mjs')
  if (existsSync(journal)) {
    const j = run(
      process.execPath,
      [journal, evt.agent ?? 'claude', evt.tool_name ?? 'Edit', p],
      { BERSERQIR_MEMORY_DIR: MEMORY_DIR },
    )
    if (j.stderr) process.stderr.write(j.stderr)
  }
  const cp = run(process.execPath, [
    join(HOOKS_DIR, 'config-protection/config-protection.mjs'),
    p,
  ])
  if (cp.status === 2) {
    blocked = cp.stderr
    trace(evt.tool_name ?? 'Edit', p, 'block:config-protection')
  }
  const mv = run(process.execPath, [
    join(HOOKS_DIR, 'memory-validate/memory-validate.mjs'),
    p,
  ])
  if (mv.status === 2) {
    blocked = (blocked ?? '') + mv.stderr
    trace(evt.tool_name ?? 'Edit', p, 'block:memory-validate')
  }
  // advisories (stray root docs, front slop/DESIGN drift) — surface, never block
  for (const adv of [
    'stray-doc/stray-doc.mjs',
    'front-quality/front-quality.mjs',
    'back-quality/back-quality.mjs',
  ]) {
    const a = join(HOOKS_DIR, adv)
    if (!existsSync(a)) continue
    const r = run(process.execPath, [a, p])
    if (r.stderr) process.stderr.write(r.stderr)
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
      .replace(/\r\n/g, '\n') // Windows editors save CRLF — regexes below assume \n
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
  // profile card (deterministic peer-card pattern): a compact read-view of
  // human-profile.md §Areas + last override, so mentorship calibration is
  // always in context — the profile is the source of truth, /learn's
  // human-gated mining is the write path, this is just the lens. ~50 tokens.
  const profPath = join(MEMORY_DIR, 'human-profile.md')
  if (existsSync(profPath)) {
    const prof = readFileSync(profPath, 'utf8').replace(/\r\n/g, '\n') // CRLF-tolerant
    const areas = (prof.match(/## Areas\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '')
      .split('\n')
      .filter((l) => /^\|/.test(l) && !/^\|[\s-]*Area|^\|[\s|:-]+\|/.test(l))
      .map((l) => l.split('|').map((c) => c.trim()))
      .filter((c) => c[1] && c[2]) // area + mode filled
      .map(
        (c) => `${c[1]}: ${c[2]}${/true/i.test(c[4] ?? '') ? ' (pinned)' : ''}`,
      )
    const overrides = (
      prof.match(/## Override log\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? ''
    )
      .split('\n')
      .filter((l) => /^- \S/.test(l.trim()) && l.trim() !== '-')
    const card = []
    if (areas.length) card.push(`- ${areas.join(' · ')}`)
    if (overrides.length)
      card.push(`- last override: ${overrides.at(-1).trim().slice(2)}`)
    if (card.length)
      out.push(
        `## Human profile card (mentorship calibration — .berserqir/protocols/mentorship.md)\n` +
          card.join('\n'),
      )
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
  // session-verify: batch-run the project's own typecheck/lint over the
  // session's touched files — once, at Stop, instead of per edit
  const sv = join(HOOKS_DIR, 'session-verify/session-verify.mjs')
  if (existsSync(sv)) {
    const r = run(process.execPath, [sv], { BERSERQIR_MEMORY_DIR: MEMORY_DIR })
    if (r.status === 2) {
      process.stderr.write(r.stderr ?? '')
      process.exit(2) // block stop once; retry carries stop_hook_active
    }
  }
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
