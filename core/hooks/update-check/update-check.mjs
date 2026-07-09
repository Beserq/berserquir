#!/usr/bin/env node
// Berserqir: update-check (update-notifier pattern — proactive, never blocking)
// Zero dependencies, cross-platform (Node).
//
// Called best-effort by the harness hook adapters (post-edit) and by the
// Claude Code session-start injection. Behavior:
//   default mode:  read cache → if stale (>24h), spawn a DETACHED background
//                  refresh (adds zero latency, offline-safe) → if the cached
//                  latest is newer than the installed version, print ONE nudge
//                  per day to stderr (exit 0 always — informational only)
//   --refresh:     blocking `npm view berserqir version` → write cache. Run by
//                  the detached child, never in the hot path.
//   --print:       like default, but prints the nudge to STDOUT (for session
//                  context injection) and never triggers a refresh spawn.
// Opt-out: BERSERQIR_NO_UPDATE_CHECK=1 (CI / air-gapped / privacy)

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.BERSERQIR_NO_UPDATE_CHECK === '1') process.exit(0)

const HOOKS_DIR = dirname(dirname(fileURLToPath(import.meta.url))) // .berserqir/hooks
const HUB = dirname(HOOKS_DIR) // .berserqir
const CACHE = join(HUB, 'update-check.json')
const DAY = 24 * 60 * 60 * 1000

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}
const manifest = readJson(join(HUB, 'manifest.json'))
const installed = manifest?.installer
if (!installed) process.exit(0) // not an installer-managed setup — nothing to compare

const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => String(v).split('.').map(Number))
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) > (y[i] || 0)) return true
    if ((x[i] || 0) < (y[i] || 0)) return false
  }
  return false
}

const mode = process.argv[2] ?? ''

if (mode === '--refresh') {
  // blocking fetch — only ever run detached, off the hot path
  const r = spawnSync('npm', ['view', 'berserqir', 'version'], {
    encoding: 'utf8',
    timeout: 10000,
  })
  const latest = (r.stdout || '').trim()
  const prev = readJson(CACHE) || {}
  writeFileSync(
    CACHE,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        latest: /^\d+\.\d+\.\d+/.test(latest) ? latest : (prev.latest ?? null),
        notifiedAt: prev.notifiedAt ?? null,
      },
      null,
      2,
    ) + '\n',
  )
  process.exit(0)
}

const cache = readJson(CACHE)
const stale = !cache || Date.now() - Date.parse(cache.checkedAt || 0) > DAY

if (stale && mode !== '--print') {
  // fire-and-forget refresh — the NEXT run sees the result; this one pays nothing
  try {
    spawn(process.execPath, [fileURLToPath(import.meta.url), '--refresh'], {
      detached: true,
      stdio: 'ignore',
    }).unref()
  } catch {
    /* spawn failure is never our caller's problem */
  }
}

if (cache?.latest && newer(cache.latest, installed)) {
  const msg = `[berserqir] update available: v${installed} → v${cache.latest} — run: npx berserqir@latest update\n`
  if (mode === '--print') {
    process.stdout.write(msg) // session-context injection — show every session start
  } else {
    // stderr nudge, throttled to once per day (edits are frequent — no spam)
    const notifiedStale =
      !cache.notifiedAt || Date.now() - Date.parse(cache.notifiedAt) > DAY
    if (notifiedStale) {
      process.stderr.write(msg)
      writeFileSync(
        CACHE,
        JSON.stringify(
          { ...cache, notifiedAt: new Date().toISOString() },
          null,
          2,
        ) + '\n',
      )
    }
  }
}
process.exit(0)
