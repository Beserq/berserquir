#!/usr/bin/env node
// Berserqir installer — detect → plan → apply. Zero dependencies (Node built-ins only).
//
// Usage:
//   npx berserqir install [--profiles front,back,ops,infra] [--dir <target>] [--yes] [--force] [--dry-run]
//   npx berserqir update | version | help
//
// Design (D8): one-shot, vendored output — npm exists only at install time.
// The compiled harness becomes part of the target repo; commit it.
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const readline = require('node:readline/promises')

const pkg = require('../package.json')
const AREAS = ['front', 'back', 'ops', 'infra']

// ---------- tiny cli plumbing ----------
const argv = process.argv.slice(2)
const VALUED = new Set(['--profiles', '--dir', '--harness'])
const flags = {}
const positional = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (VALUED.has(a)) flags[a.slice(2)] = argv[++i]
  else if (a === '--yes' || a === '-y') flags.yes = true
  else if (a === '--force') flags.force = true
  else if (a === '--dry-run') flags.dryRun = true
  else if (a.startsWith('-')) die(`unknown flag ${a} (see: npx berserqir help)`)
  else positional.push(a)
}
const cmd = positional[0] || 'help'

function info(m) {
  console.log(`  ${m}`)
}
function warn(m) {
  console.log(`  ⚠ ${m}`)
}
function ok(m) {
  console.log(`  ✔ ${m}`)
}
function die(m) {
  console.error(`  ✖ ${m}`)
  process.exit(1)
}

async function ask(q, def) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    const a = (await rl.question(`  ${q}${def ? ` [${def}]` : ''}: `)).trim()
    return a || def || ''
  } finally {
    rl.close()
  }
}

const sha = (f) =>
  crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
}
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

// ---------- sources: published package (bin/..) or monorepo dev (bin/../..) ----------
function sourcesRoot() {
  for (const c of [path.join(__dirname, '..'), path.join(__dirname, '../..')]) {
    if (
      fs.existsSync(path.join(c, 'core')) &&
      fs.existsSync(path.join(c, 'adapters/copilot/compile.mjs'))
    )
      return c
  }
  return null
}

// ---------- detect ----------
function readDeps(dir) {
  const p = readJson(path.join(dir, 'package.json'))
  return new Set(
    Object.keys({ ...(p?.dependencies || {}), ...(p?.devDependencies || {}) }),
  )
}
function detectProfiles(dir) {
  const has = (...ps) => ps.some((p) => fs.existsSync(path.join(dir, p)))
  const deps = readDeps(dir)
  const dep = (...ds) => ds.some((d) => deps.has(d))
  let top = []
  try {
    top = fs.readdirSync(dir)
  } catch {}
  const ext = (...es) => top.some((f) => es.some((e) => f.endsWith(e)))
  const out = []
  if (
    has(
      'components',
      'src/components',
      'app/components',
      'pages',
      'src/pages',
      'app/pages',
      'layouts',
    ) ||
    dep('react', 'vue', 'svelte', 'next', 'nuxt', 'astro', '@angular/core')
  )
    out.push('front')
  if (
    has('server', 'src/server', 'api', 'src/api', 'src/routes') ||
    dep('express', 'fastify', 'koa', 'hono', '@nestjs/core')
  )
    out.push('back')
  if (
    has(
      '.github/workflows',
      '.gitlab-ci.yml',
      'Dockerfile',
      'docker-compose.yml',
      'compose.yaml',
    )
  )
    out.push('ops')
  if (has('k8s', 'helm', 'terraform', 'Pulumi.yaml') || ext('.tf', '.bicep'))
    out.push('infra')
  return out
}

// ---------- install / update ----------
async function install({ isUpdate = false } = {}) {
  const target = path.resolve(flags.dir || '.')
  const src = sourcesRoot()
  if (!src)
    die(
      'cannot locate berserqir sources (core/, adapters/) — corrupted package?',
    )
  const harness = flags.harness || 'copilot'
  if (harness !== 'copilot')
    die(
      `harness "${harness}" is not available yet — this version ships the GitHub Copilot adapter only`,
    )

  console.log(
    `\n  ⚔️  berserqir v${pkg.version} — ${isUpdate ? 'update' : 'install'} (${harness})\n`,
  )

  // git context (informational — hooks resolve paths from the git root)
  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: target,
    encoding: 'utf8',
  })
  const gitRoot = git.status === 0 ? git.stdout.trim() : null
  if (!gitRoot)
    warn('target is not a git repository — git-dependent hooks will be inert')
  else if (path.resolve(gitRoot) !== target)
    warn(
      `target is not the git root (${gitRoot}) — hooks resolve paths from the git root`,
    )

  const prevManifest = readJson(path.join(target, '.berserqir/manifest.json'))
  if (isUpdate && !prevManifest)
    die('nothing to update here — run: npx berserqir install')
  if (prevManifest)
    info(
      `existing install found (compiled ${prevManifest.compiledAt || '?'}, profiles: ${(prevManifest.profiles || []).join(', ') || 'core'})`,
    )

  // profiles: flag > manifest (update) > prompt(detected)
  let profiles = flags.profiles
  if (!profiles && isUpdate && prevManifest?.profiles) {
    profiles =
      prevManifest.profiles
        .map((p) => p.split('/')[0])
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(',') || 'core'
    info(`reusing installed areas: ${profiles}`)
  }
  if (!profiles) {
    const detected = detectProfiles(target)
    const suggested = detected.length ? detected.join(',') : 'full'
    if (detected.length) info(`detected areas: ${detected.join(', ')}`)
    profiles =
      flags.yes || !process.stdin.isTTY
        ? suggested
        : await ask(
            `Areas to install (${AREAS.join(',')} — "full" for everything, "core" for core-only)`,
            suggested,
          )
  }
  const tokens = profiles
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const profArg = tokens.some(
    (t) => t === 'full' || t === 'stack' || t === 'all',
  )
    ? AREAS.join(',')
    : tokens.filter((s) => s !== 'core').join(',')

  // compile canonical sources into a temp dir
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'berserqir-'))
  try {
    // model roster customized by /init (question 8) feeds the recompile
    const userModels = path.join(target, '.berserqir/models.json')
    const modelArgs = fs.existsSync(userModels) ? ['--models', userModels] : []
    if (modelArgs.length)
      info('using your model roster (.berserqir/models.json)')
    const res = spawnSync(
      process.execPath,
      [
        path.join(src, 'adapters/copilot/compile.mjs'),
        '--root',
        src,
        '--out',
        tmp,
        '--profiles',
        profArg || 'core',
        ...modelArgs,
      ],
      { encoding: 'utf8' },
    )
    if (res.status !== 0) die(`compile failed:\n${res.stderr || res.stdout}`)
    info(
      (res.stdout || '')
        .trim()
        .split('\n')[0]
        .replace(/^\[.*?\]\s*/, 'compiled: '),
    )

    // plan
    const compiled = walk(tmp).map((f) => path.relative(tmp, f))
    const plan = { fresh: [], same: [], auto: [], modified: [] }
    for (const rel of compiled) {
      if (rel === '.berserqir/manifest.json') continue // always rewritten (carries hashes)
      const destAbs = path.join(target, rel)
      if (!fs.existsSync(destAbs)) {
        plan.fresh.push(rel)
        continue
      }
      const dh = sha(destAbs)
      if (dh === sha(path.join(tmp, rel))) plan.same.push(rel)
      else if (prevManifest?.hashes?.[rel] === dh)
        plan.auto.push(rel) // untouched since last install → safe update
      else plan.modified.push(rel) // user-modified (or unknown origin) → needs consent
    }
    // orphans: files the previous install managed that this version no longer ships
    const compiledSet = new Set(compiled)
    const orphans = { removable: [], kept: [] }
    for (const [rel, oldHash] of Object.entries(prevManifest?.hashes || {})) {
      if (compiledSet.has(rel)) continue
      const abs = path.join(target, rel)
      if (!fs.existsSync(abs)) continue
      if (sha(abs) === oldHash)
        orphans.removable.push(rel) // untouched → safe to delete
      else orphans.kept.push(rel) // user modified it → never delete
    }
    info(`plan for ${target}`)
    console.log(
      `    new: ${plan.fresh.length} · already current: ${plan.same.length} · safe update: ${plan.auto.length} · conflicts: ${plan.modified.length} · orphans: ${orphans.removable.length}`,
    )
    if (plan.modified.length)
      console.log(plan.modified.map((r) => `      ! ${r}`).join('\n'))
    if (orphans.removable.length)
      console.log(
        orphans.removable.map((r) => `      - ${r} (no longer shipped)`).join('\n'),
      )
    if (orphans.kept.length)
      warn(
        `${orphans.kept.length} orphaned file(s) kept (you modified them): ${orphans.kept.join(', ')}`,
      )
    if (flags.dryRun) {
      info('dry-run — nothing written')
      return
    }

    // conflicts: only overwritten with explicit consent (--force or interactive yes)
    let overwriteModified = false
    if (plan.modified.length) {
      if (flags.force) overwriteModified = true
      else if (!flags.yes && process.stdin.isTTY) {
        const a = (
          await ask(
            `${plan.modified.length} file(s) differ from the compiled version (possibly your edits). Overwrite? (y/N)`,
            'N',
          )
        ).toLowerCase()
        overwriteModified = a === 'y' || a === 'yes'
      }
      if (!overwriteModified)
        warn(
          `keeping ${plan.modified.length} modified file(s) — re-run with --force to overwrite`,
        )
    }

    if (!flags.yes && process.stdin.isTTY) {
      const go = (await ask('Proceed? (Y/n)', 'Y')).toLowerCase()
      if (go === 'n' || go === 'no') die('aborted — nothing written')
    }

    // apply
    const toWrite = [
      ...plan.fresh,
      ...plan.auto,
      ...(overwriteModified ? plan.modified : []),
    ]
    for (const rel of toWrite) {
      const from = path.join(tmp, rel),
        to = path.join(target, rel)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
      fs.chmodSync(to, fs.statSync(from).mode) // hooks keep their exec bit
    }

    // remove safe orphans + now-empty directories
    for (const rel of orphans.removable) {
      fs.rmSync(path.join(target, rel), { force: true })
      let dir = path.dirname(path.join(target, rel))
      while (
        dir.startsWith(target) &&
        dir !== target &&
        fs.existsSync(dir) &&
        fs.readdirSync(dir).length === 0
      ) {
        fs.rmdirSync(dir)
        dir = path.dirname(dir)
      }
    }

    // manifest: hashes are of the COMPILED artifacts — disk == hash ⇒ untouched by user
    const hashes = {}
    for (const rel of compiled)
      if (rel !== '.berserqir/manifest.json')
        hashes[rel] = sha(path.join(tmp, rel))
    const m = readJson(path.join(tmp, '.berserqir/manifest.json')) || {}
    m.installedAt = new Date().toISOString()
    m.installer = pkg.version
    m.hashes = hashes
    fs.mkdirSync(path.join(target, '.berserqir'), { recursive: true })
    fs.writeFileSync(
      path.join(target, '.berserqir/manifest.json'),
      JSON.stringify(m, null, 2) + '\n',
    )

    ok(
      `wrote ${toWrite.length} file(s) · ${plan.same.length} already current · ${overwriteModified ? 0 : plan.modified.length} kept · ${orphans.removable.length} orphan(s) removed`,
    )
    console.log(`
  Next steps:
    1. Review & commit — the harness is vendored, it is part of your repo now.
    2. Open in VS Code (Copilot) and run /init to seed project memory
       (or /berserqir status to see what's missing).
    3. Smoke-check with /run-evals.
`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ---------- doctor: deterministic health checks (zero-LLM) ----------
// Fuses: ECC harness-audit (score + top actions) + Impeccable deterministic
// detectors + AgentShield-lite (self-audit of the installed harness).
async function doctor() {
  const target = path.resolve(flags.dir || '.')
  const checks = [] // { name, points, pass, fix }
  const add = (name, points, pass, fix) =>
    checks.push({ name, points, pass: !!pass, fix })
  const exists = (rel) => fs.existsSync(path.join(target, rel))
  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(target, rel), 'utf8')
    } catch {
      return null
    }
  }

  console.log(`\n  ⚔️  berserqir v${pkg.version} — doctor\n`)

  // 1) installation integrity
  const manifest = readJson(path.join(target, '.berserqir/manifest.json'))
  add('manifest present', 4, manifest, 'run: npx berserqir install')
  if (manifest) {
    add(
      'manifest has hashes (installer-managed)',
      2,
      manifest.hashes,
      'reinstall via npx berserqir install (manual copies lack update protection)',
    )
    let missing = 0,
      modified = 0
    for (const [rel, h] of Object.entries(manifest.hashes || {})) {
      const abs = path.join(target, rel)
      if (!fs.existsSync(abs)) missing++
      else if (sha(abs) !== h) modified++
    }
    add(
      `no missing harness files (${missing} missing)`,
      3,
      missing === 0,
      'npx berserqir update restores them',
    )
    if (modified > 0)
      info(
        `ℹ ${modified} file(s) locally modified — fine, update will preserve them`,
      )
    const hookFiles = Object.keys(manifest.hashes || {}).filter(
      (f) => /\.(sh|mjs)$/.test(f) && f.includes('hooks/'),
    )
    const badBits = hookFiles.filter((f) => {
      try {
        return (
          !(fs.statSync(path.join(target, f)).mode & 0o111) && f.endsWith('.sh')
        )
      } catch {
        return false
      }
    })
    add(
      'hook scripts executable',
      2,
      badBits.length === 0,
      `chmod +x ${badBits.join(' ')}`,
    )
  }
  add(
    'hooks wired (.github/hooks/berserqir.json)',
    2,
    exists('.github/hooks/berserqir.json'),
    'npx berserqir update',
  )

  // 2) guardrails intact
  for (const g of [
    'git-safety/git-safety.sh',
    'secret-scan/secret-scan.sh',
    'config-protection/config-protection.sh',
    'memory-validate/memory-validate.mjs',
  ])
    add(
      `guardrail ${g.split('/')[0]}`,
      1,
      exists(`.berserqir/hooks/${g}`),
      'npx berserqir update',
    )

  // 3) memory & SDD
  const memFiles = [
    'memory-long.md',
    'memory-short.md',
    'memory-medium.json',
    'codemap.md',
  ]
  const memPresent = memFiles.filter((f) => exists(`.berserqir/memory/${f}`))
  add(
    `memory seeded (${memPresent.length}/${memFiles.length})`,
    3,
    memPresent.length === memFiles.length,
    'run /init in your harness chat',
  )
  for (const f of ['memory-long.md', 'memory-short.md', 'codemap.md']) {
    const raw = read(`.berserqir/memory/${f}`)
    if (!raw) continue
    const budgets = {
      'memory-long.md': 4000,
      'memory-short.md': 2500,
      'codemap.md': 2000,
    }
    const tok = Math.round(raw.length / 4)
    add(
      `${f} within budget (~${tok} tok)`,
      1,
      tok <= budgets[f],
      `run /compress (budget ${budgets[f]})`,
    )
  }
  add(
    'SDD present (PRD/SPECS/TESTS)',
    2,
    exists('PRD.md') && exists('SPECS.md') && exists('TESTS.md'),
    'run /init to scaffold drafts',
  )
  // informational (0 points): native git pre-commit hook activation
  if (
    exists('.berserqir/hooks/commit-quality/commit-quality.sh') &&
    !exists('.git/hooks/pre-commit')
  )
    info(
      'ℹ commit-quality available but not active — ln -s ../../.berserqir/hooks/commit-quality/commit-quality.sh .git/hooks/pre-commit',
    )

  // 4) graph integrity (anchors resolve, no ghosts)
  const graph = readJson(path.join(target, '.berserqir/memory/graph.json'))
  if (graph) {
    const ids = new Set((graph.nodes || []).map((n) => n.id))
    const ghostEdges = (graph.edges || []).filter(
      (e) => !ids.has(e.from) || !ids.has(e.to),
    )
    add(
      'graph: no ghost edges',
      2,
      ghostEdges.length === 0,
      `fix ${ghostEdges.length} edge(s) referencing unknown nodes`,
    )
    const ghostFiles = (graph.nodes || []).filter(
      (n) => (n.type === 'file' || n.type === 'module') && !exists(n.id),
    )
    add(
      'graph: node paths exist on disk',
      2,
      ghostFiles.length === 0,
      `${ghostFiles.length} node(s) point at deleted paths — update graph.json`,
    )
  }
  const memLong = read('.berserqir/memory/memory-long.md')
  const specs = read('SPECS.md')
  if (memLong && specs) {
    const refs = [...new Set(memLong.match(/ADR-\d{3,}/g) || [])]
    const dangling = refs.filter((r) => !specs.includes(r))
    add(
      'anchors: memory-long ADRs resolve in SPECS',
      2,
      dangling.length === 0,
      `dangling: ${dangling.join(', ')}`,
    )
  }

  // 5) version freshness (never blocks — Impeccable UPDATE_AVAILABLE pattern)
  try {
    const r = spawnSync('npm', ['view', 'berserqir', 'version'], {
      encoding: 'utf8',
      timeout: 5000,
    })
    const latest = (r.stdout || '').trim()
    const newer = (a, b) => {
      // a > b?
      const [x, y] = [a, b].map((v) => v.split('.').map(Number))
      for (let i = 0; i < 3; i++) {
        if ((x[i] || 0) > (y[i] || 0)) return true
        if ((x[i] || 0) < (y[i] || 0)) return false
      }
      return false
    }
    if (latest && newer(latest, pkg.version))
      info(
        `ℹ UPDATE_AVAILABLE: v${latest} on npm (you run v${pkg.version}) — npx berserqir@latest update`,
      )
  } catch {
    /* offline is fine */
  }

  // report
  const earned = checks.filter((c) => c.pass).reduce((s, c) => s + c.points, 0)
  const total = checks.reduce((s, c) => s + c.points, 0)
  console.log('')
  for (const c of checks) console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}`)
  const fails = checks.filter((c) => !c.pass)
  console.log(
    `\n  score: ${earned}/${total}${fails.length ? '\n\n  top actions:' : ' — all clear ⚔️'}`,
  )
  fails
    .slice(0, 3)
    .forEach((c, i) => console.log(`    ${i + 1}) [${c.name}] ${c.fix}`))
  console.log('')
  process.exitCode = fails.some((c) => c.points >= 3) ? 1 : 0
}

// ---------- uninstall: remove managed files, preserve human work ----------
async function uninstall() {
  const target = path.resolve(flags.dir || '.')
  const manifest = readJson(path.join(target, '.berserqir/manifest.json'))
  if (!manifest?.hashes)
    die('no installer-managed harness found here (no manifest with hashes)')

  console.log(`\n  ⚔️  berserqir v${pkg.version} — uninstall\n`)

  // NEVER touched: user memory, SDD, anything not in the manifest
  const PRESERVE = /^\.berserqir\/memory\/(?!templates\/|schemas\/)/
  const removable = []
  const modified = []
  const preserved = []
  for (const [rel, h] of Object.entries(manifest.hashes)) {
    const abs = path.join(target, rel)
    if (!fs.existsSync(abs)) continue
    if (PRESERVE.test(rel)) {
      preserved.push(rel)
      continue
    }
    if (sha(abs) === h) removable.push(rel)
    else modified.push(rel)
  }
  info(`${removable.length} managed file(s) to remove`)
  if (modified.length)
    warn(`${modified.length} file(s) you modified — removed only with --force:`)
  if (modified.length) console.log(modified.map((r) => `      ! ${r}`).join('\n'))
  info(
    'preserved always: your memory files (memory-*.md/json, codemap, graph, human-profile), PRD/SPECS/TESTS',
  )
  if (flags.dryRun) {
    info('dry-run — nothing removed')
    return
  }

  if (!flags.yes) {
    if (!process.stdin.isTTY)
      die('uninstall requires --yes in non-interactive mode')
    const a = (
      await ask(`Remove the harness from ${target}? (y/N)`, 'N')
    ).toLowerCase()
    if (a !== 'y' && a !== 'yes') die('aborted — nothing removed')
  }

  const toRemove = [...removable, ...(flags.force ? modified : [])]
  for (const rel of toRemove) {
    fs.rmSync(path.join(target, rel), { force: true })
    let dir = path.dirname(path.join(target, rel))
    while (
      dir.startsWith(target) &&
      dir !== target &&
      fs.existsSync(dir) &&
      fs.readdirSync(dir).length === 0
    ) {
      fs.rmdirSync(dir)
      dir = path.dirname(dir)
    }
  }
  // manifest goes last (unless memory kept .berserqir alive)
  fs.rmSync(path.join(target, '.berserqir/manifest.json'), { force: true })
  const bq = path.join(target, '.berserqir')
  if (fs.existsSync(bq) && walk(bq).length === 0)
    fs.rmSync(bq, { recursive: true, force: true })

  ok(
    `removed ${toRemove.length} file(s) · ${flags.force ? 0 : modified.length} modified file(s) kept · memory/SDD untouched`,
  )
}

// ---------- help / dispatch ----------
function help() {
  console.log(`
  ⚔️  berserqir v${pkg.version} — the agent legion harness
      SDD + hierarchical memory + agentic loop + behavioral evals,
      portable across GitHub Copilot, Claude Code and Cursor.

  Usage:
    npx berserqir install [options]   Install the harness into a repo
    npx berserqir update  [options]   Recompile + refresh an existing install
    npx berserqir doctor  [--dir]     Deterministic health check (zero-LLM)
    npx berserqir uninstall [--dir]   Remove managed files (memory/SDD preserved)
    npx berserqir version             Print version

  Options:
    --profiles <list>   Areas: ${AREAS.join(',')} · "full" = everything · "core" = core-only
    --dir <path>        Target repo (default: current directory)
    --harness <name>    Target harness (default: copilot — others coming)
    --yes, -y           Accept detected defaults, skip confirmations
    --force             Overwrite files you modified since the last install
    --dry-run           Show the plan, write nothing
`)
}

;(async () => {
  if (cmd === 'install') await install()
  else if (cmd === 'update') await install({ isUpdate: true })
  else if (cmd === 'doctor') await doctor()
  else if (cmd === 'uninstall') await uninstall()
  else if (cmd === 'version' || cmd === '--version' || cmd === '-v')
    console.log(pkg.version)
  else help()
})().catch((e) => die(e.message || String(e)))
