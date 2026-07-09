#!/usr/bin/env node
// Berserqir → Copilot hook adapter (DRY pattern: normalize harness payload,
// delegate to canonical zero-deps hooks). Vendored to .berserqir/hooks/.
//
// Wired via .github/hooks/berserqir.json (postToolUse: edit|create|apply_patch).
// Defensive: unknown payload shapes → exit 0 silently (never break the harness).

import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOKS_DIR = dirname(fileURLToPath(import.meta.url))

// ---- read + normalize event (tolerant to schema variations) ----
let evt = {}
try {
  evt = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  /* no/invalid stdin */
}

const paths = [
  evt.tool_input?.file_path,
  evt.tool_input?.filePath,
  evt.file_path,
  evt.filePath,
  evt.path,
  ...(Array.isArray(evt.files) ? evt.files : []),
].filter(Boolean)
const tool = evt.tool_name ?? evt.tool ?? 'edit'
const agent = evt.agent ?? evt.agent_name ?? 'copilot'

if (paths.length === 0) process.exit(0)

// ---- run canonical guardrails per path ----
let blocked = null
for (const p of paths) {
  const cp = spawnSync(
    process.execPath,
    [join(HOOKS_DIR, 'config-protection/config-protection.mjs'), p],
    { encoding: 'utf8' },
  )
  if (cp.status === 2) blocked = cp.stderr

  const mv = spawnSync(
    process.execPath,
    [join(HOOKS_DIR, 'memory-validate/memory-validate.mjs'), p],
    { encoding: 'utf8' },
  )
  if (mv.status === 2) blocked = (blocked ?? '') + mv.stderr

  // deterministic journal (best-effort, never blocks)
  const journal = join(HOOKS_DIR, 'memory-journal/memory-journal.mjs')
  if (existsSync(journal))
    spawnSync(process.execPath, [journal, agent, tool, p], { encoding: 'utf8' })
}

if (blocked) {
  process.stderr.write(blocked)
  process.exit(2)
}
process.exit(0)
