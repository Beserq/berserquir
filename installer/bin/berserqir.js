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
  else if (a === '--fix') flags.fix = true
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

// which harness does this repo already use? (signals, strongest first)
function detectHarness(target) {
  const has = (p) => fs.existsSync(path.join(target, p))
  const out = []
  if (has('.claude') || has('CLAUDE.md')) out.push('claude-code')
  if (has('.cursor')) out.push('cursor')
  if (
    has('.github/copilot-instructions.md') ||
    has('.github/prompts') ||
    has('.github/agents')
  )
    out.push('copilot')
  return out
}

// which IDE/agent terminal is running this command? (environment signals — strongest of all)
function detectIdeEnv() {
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT)
    return 'claude-code' // spawned by a Claude Code session
  if (process.env.CURSOR_TRACE_ID) return 'cursor'
  if (process.env.TERM_PROGRAM === 'vscode')
    return /cursor/i.test(process.env.VSCODE_GIT_ASKPASS_MAIN || '')
      ? 'cursor' // Cursor is a VS Code fork — disambiguate via helper paths
      : 'copilot'
  return null
}

// ---------- install / update ----------
async function install({ isUpdate = false } = {}) {
  const target = path.resolve(flags.dir || '.')
  const src = sourcesRoot()
  if (!src)
    die(
      'cannot locate berserqir sources (core/, adapters/) — corrupted package?',
    )
  const prevManifest = readJson(path.join(target, '.berserqir/manifest.json'))
  const HARNESSES = ['copilot', 'claude-code', 'cursor']
  // harness: flag > manifest (update) > detect(IDE env, repo signals) + prompt
  let harness = flags.harness || prevManifest?.harness
  if (!harness) {
    const envIde = detectIdeEnv()
    const detected = detectHarness(target)
    if (envIde) info(`running inside a ${envIde} terminal`)
    if (detected.length) info(`repo harness signal(s): ${detected.join(', ')}`)
    const suggested = envIde || detected[0] || 'copilot'
    harness =
      flags.yes || !process.stdin.isTTY
        ? suggested
        : await ask(`Target harness (${HARNESSES.join(' | ')})`, suggested)
  }
  harness = harness.trim().toLowerCase()
  if (!HARNESSES.includes(harness))
    die(
      `harness "${harness}" is not available — this version ships: ${HARNESSES.join(', ')}`,
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

  // MCP servers (informational — /init question 9 maps them for the orchestrator)
  const mcpConfigs = [
    '.mcp.json',
    '.cursor/mcp.json',
    '.vscode/mcp.json',
  ].filter((p) => fs.existsSync(path.join(target, p)))
  if (mcpConfigs.length)
    info(
      `MCP config(s) detected: ${mcpConfigs.join(', ')} — /init (question 9) maps them for the orchestrator`,
    )

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
        path.join(src, 'adapters', harness, 'compile.mjs'),
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
        orphans.removable
          .map((r) => `      - ${r} (no longer shipped)`)
          .join('\n'),
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
    const chatHint =
      harness === 'claude-code'
        ? 'Run `claude` in this repo and use /berserqir init to seed project memory'
        : harness === 'cursor'
          ? 'Open in Cursor and run /berserqir init to seed project memory'
          : 'Open in VS Code (Copilot) and run /init to seed project memory'
    console.log(`
  Next steps:
    1. Review & commit — the harness is vendored, it is part of your repo now.
    2. ${chatHint}
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
async function doctor(isRerun = false) {
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
  const wiringFile =
    manifest?.harness === 'claude-code'
      ? '.claude/settings.json'
      : manifest?.harness === 'cursor'
        ? '.cursor/hooks.json'
        : '.github/hooks/berserqir.json'
  add(
    `hooks wired (${wiringFile})`,
    2,
    exists(wiringFile),
    'npx berserqir update',
  )

  // 2) guardrails intact
  for (const g of [
    'git-safety/git-safety.mjs',
    'cmd-safety/cmd-safety.mjs',
    'secret-scan/secret-scan.mjs',
    'config-protection/config-protection.mjs',
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
    'instincts.json',
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
  // informational (0 points): front-area design artifact + unmapped MCP servers
  if ((manifest?.profiles || []).includes('front') && !exists('DESIGN.md'))
    info(
      'ℹ front installed but no DESIGN.md — run /init (question 10) to seed the visual system',
    )
  const mcpDetected = [
    '.mcp.json',
    '.cursor/mcp.json',
    '.vscode/mcp.json',
  ].some((p) => exists(p))
  if (mcpDetected && !exists('.berserqir/memory/mcp-map.json'))
    info(
      'ℹ MCP config(s) present but unmapped — run /init (question 9) so the orchestrator can route to them',
    )
  // informational (0 points): native git pre-commit hook activation
  if (
    exists('.berserqir/hooks/commit-quality/commit-quality.mjs') &&
    !exists('.git/hooks/pre-commit')
  )
    info(
      'ℹ commit-quality available but not active — run: npx berserqir hook-install',
    )
  // informational (0 points): live memory files missing template frontmatter keys
  // (live memory is the user's — update never touches it; --fix merges keys only)
  const fmDrift = frontmatterDrift(target)
  if (fmDrift.length)
    info(
      `ℹ ${fmDrift.length} memory file(s) missing frontmatter key(s) from their templates (${fmDrift
        .map((d) => d.name)
        .join(', ')}) — npx berserqir doctor --fix syncs them`,
    )
  // informational (0 points): evolve-ready instinct clusters
  const instincts = readJson(
    path.join(target, '.berserqir/memory/instincts.json'),
  )
  if (instincts) {
    const byScope = {}
    for (const i of instincts.instincts || [])
      if (i.status === 'active' && i.confidence >= 0.7)
        byScope[i.scope] = (byScope[i.scope] || 0) + 1
    const ready = Object.entries(byScope).filter(([, n]) => n >= 3)
    if (ready.length)
      info(
        `ℹ evolve-ready instinct cluster(s): ${ready
          .map(([s, n]) => `${s} (${n})`)
          .join(', ')} — run /evolve in your harness chat`,
      )
  }

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
      shell: process.platform === 'win32', // npm is npm.cmd on Windows
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

  // --fix: apply the mechanical remedies (never the semantic ones — /init and
  // /compress are agent work), then re-run the checks once to show the result.
  if (flags.fix && !isRerun) {
    let fixed = 0
    // 1) exec bits on hook scripts
    if (fs.existsSync(path.join(target, '.berserqir/hooks')))
      for (const f of walk(path.join(target, '.berserqir/hooks')))
        if (/\.(sh|mjs)$/.test(f)) {
          try {
            if (!(fs.statSync(f).mode & 0o111)) {
              fs.chmodSync(f, 0o755)
              fixed++
            }
          } catch {}
        }
    // 2) missing machine-seeded memory skeletons (instincts.json is an empty
    //    template — deterministic; the semantic files stay /init's job)
    const instPath = path.join(target, '.berserqir/memory/instincts.json')
    const instTpl = path.join(
      target,
      '.berserqir/memory/templates/instincts.template.json',
    )
    if (!fs.existsSync(instPath) && fs.existsSync(instTpl)) {
      fs.copyFileSync(instTpl, instPath)
      info('fixed: seeded instincts.json from template')
      fixed++
    }
    // 2b) frontmatter keys the template gained since this memory file was
    //     seeded (additive only — never a value change, never the body)
    for (const d of frontmatterDrift(target)) {
      const live = fs.readFileSync(d.livePath, 'utf8')
      const eol = live.includes('\r\n') ? '\r\n' : '\n' // respect the file's own line endings
      const close = live.match(/\r?\n---/)
      if (!close) continue
      fs.writeFileSync(
        d.livePath,
        live.slice(0, close.index) +
          eol +
          d.missing.join(eol) +
          live.slice(close.index),
      )
      info(
        `fixed: added ${d.missing.length} frontmatter key(s) to ${d.name} (${d.missing
          .map((l) => l.split(':')[0])
          .join(', ')})`,
      )
      fixed++
    }
    // 3) managed files missing/broken (wiring, guardrails) → update repairs them
    const managedBroken = fails.some(
      (c) => c.name.startsWith('guardrail') || c.name.startsWith('hooks wired'),
    )
    if (managedBroken) {
      info('managed files broken — running: npx berserqir update --yes')
      const r = spawnSync(
        process.execPath,
        [__filename, 'update', '--yes', '--dir', target],
        { stdio: 'inherit' },
      )
      if (r.status === 0) fixed++
    }
    if (fixed) {
      console.log(`  → applied ${fixed} fix(es); re-checking\n`)
      return doctor(true)
    }
    info(
      'nothing mechanically fixable — remaining actions need /init, /compress or a human decision',
    )
  }

  process.exitCode = fails.some((c) => c.points >= 3) ? 1 : 0
}

// ---------- frontmatter drift: template keys a live memory file was seeded without ----------
// Live memory is user-owned — update never rewrites it. But frontmatter keys are
// harness-owned metadata (sizeBudget, ttl…): when a template gains one, doctor
// reports it and --fix merges the MISSING lines only. Values and body untouched.
function frontmatterDrift(target) {
  // CRLF-tolerant: Windows checkouts (autocrlf) and Windows editors save \r\n
  const fmLines = (text) => {
    const t = text.replace(/\r\n/g, '\n')
    if (!t.startsWith('---\n')) return null
    const end = t.indexOf('\n---', 4)
    if (end === -1) return null
    return t.slice(4, end).split('\n')
  }
  const out = []
  const tplDir = path.join(target, '.berserqir/memory/templates')
  if (!fs.existsSync(tplDir)) return out
  for (const name of [
    'memory-long.md',
    'memory-short.md',
    'codemap.md',
    'human-profile.md',
  ]) {
    const livePath = path.join(target, '.berserqir/memory', name)
    const tplPath = path.join(tplDir, name.replace('.md', '.template.md'))
    if (!fs.existsSync(livePath) || !fs.existsSync(tplPath)) continue
    const live = fmLines(fs.readFileSync(livePath, 'utf8'))
    const tpl = fmLines(fs.readFileSync(tplPath, 'utf8'))
    if (!live || !tpl) continue
    const liveKeys = new Set(
      live.map((l) => l.match(/^([\w-]+)\s*:/)?.[1]).filter(Boolean),
    )
    const missing = tpl.filter((l) => {
      const k = l.match(/^([\w-]+)\s*:/)?.[1]
      return k && !liveKeys.has(k)
    })
    if (missing.length) out.push({ name, livePath, missing })
  }
  return out
}

// ---------- verify: close the supply chain — sealed witness → disk ----------
// The install manifest answers "did anything change since install?" (computed
// locally, trusts the tarball). The witness answers "is this package the bytes
// the CI released?" — sealed at pack time inside the tarball, which the npm
// --provenance attestation (Sigstore, keyless) covers. Tampered package ⇒
// either the attestation breaks or the witness mismatches. Exit 1 only on
// witness mismatch; local drift of managed files is yours and informational.
async function verify() {
  const target = path.resolve(flags.dir || process.cwd())
  const pkgRootDir = path.join(__dirname, '..')
  console.log(`\n  ⚔️  berserqir v${pkg.version} — verify\n`)
  let failed = false

  // 1) package bytes vs sealed witness
  const witness = readJson(path.join(pkgRootDir, 'witness.json'))
  if (!witness) {
    info(
      'no sealed witness in this package — dev checkout or a pre-witness release (≤ 0.6.x); packs seal it in CI',
    )
  } else {
    const bad = []
    for (const [rel, h] of Object.entries(witness.files)) {
      const abs = path.join(pkgRootDir, rel)
      if (!fs.existsSync(abs)) bad.push(`${rel} (missing)`)
      else if (sha(abs) !== h) bad.push(rel)
    }
    if (bad.length) {
      warn(
        `WITNESS MISMATCH — ${bad.length} file(s) differ from the sealed release:`,
      )
      bad.slice(0, 10).forEach((r) => console.log(`      ! ${r}`))
      warn(
        'do NOT trust this package — reinstall from the registry: npx berserqir@latest',
      )
      failed = true
    } else {
      ok(
        `package bytes match the sealed witness — ${Object.keys(witness.files).length} files, sealed ${witness.sealedAt} (v${witness.version})`,
      )
    }
  }

  // 2) provenance attestation (registry-reported — best-effort, offline-safe)
  try {
    const r = spawnSync(
      'npm',
      ['view', `berserqir@${pkg.version}`, 'dist.attestations.url'],
      {
        encoding: 'utf8',
        timeout: 8000,
        shell: process.platform === 'win32',
      },
    )
    const url = (r.stdout || '').trim()
    if (url)
      ok(`provenance attestation published for v${pkg.version} (Sigstore)`)
    else
      info(
        `no provenance attestation reported by the registry for v${pkg.version}`,
      )
  } catch {
    info('registry unreachable — attestation check skipped (offline)')
  }

  // 3) installed managed files vs the install manifest (local drift — yours)
  const manifest = readJson(path.join(target, '.berserqir/manifest.json'))
  if (manifest?.hashes) {
    let drift = 0
    for (const [rel, h] of Object.entries(manifest.hashes)) {
      const abs = path.join(target, rel)
      if (fs.existsSync(abs) && sha(abs) !== h) drift++
    }
    if (drift)
      info(
        `${drift} managed file(s) differ from your install manifest — expected if you customized them (npx berserqir update shows the plan)`,
      )
    else ok('installed managed files match the install manifest')
  } else {
    info(
      'no install manifest here — run verify from a repo with Berserqir installed (or pass --dir)',
    )
  }

  console.log('')
  if (failed) process.exit(1)
}

// ---------- hook-install: wire commit-quality as native git hooks ----------
// Git runs hooks via its bundled sh on every OS (Windows included) — a
// two-line sh wrapper calling node is the most portable activation there is.
const GIT_HOOK_MARK = '# berserqir-managed'
const GIT_HOOKS = {
  'pre-commit': 'exec node .berserqir/hooks/commit-quality/commit-quality.mjs',
  'commit-msg':
    'exec node .berserqir/hooks/commit-quality/commit-quality.mjs "$1"',
}
function hookInstall() {
  const target = path.resolve(flags.dir || '.')
  const gitDir = path.join(target, '.git')
  if (!fs.existsSync(gitDir))
    die('no .git directory here — run inside a git repository')
  if (
    !fs.existsSync(
      path.join(target, '.berserqir/hooks/commit-quality/commit-quality.mjs'),
    )
  )
    die('commit-quality hook not found — run npx berserqir install first')
  console.log(`\n  ⚔️  berserqir v${pkg.version} — hook-install\n`)
  for (const [name, cmd] of Object.entries(GIT_HOOKS)) {
    const p = path.join(gitDir, 'hooks', name)
    if (
      fs.existsSync(p) &&
      !fs.readFileSync(p, 'utf8').includes(GIT_HOOK_MARK)
    ) {
      if (!flags.force) {
        warn(
          `.git/hooks/${name} exists and is not berserqir-managed — skipped (--force overwrites, or chain it manually)`,
        )
        continue
      }
      warn(`overwriting existing .git/hooks/${name} (--force)`)
    }
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, `#!/bin/sh\n${GIT_HOOK_MARK}\n${cmd}\n`)
    try {
      fs.chmodSync(p, 0o755)
    } catch {
      /* Git for Windows needs no chmod */
    }
    ok(
      `.git/hooks/${name} → commit-quality (${name === 'commit-msg' ? 'conventional-commit check' : 'secrets · size · debug leftovers'})`,
    )
  }
  info(
    'undo anytime: npx berserqir hook-uninstall · bypass once: BERSERQIR_COMMIT_ALLOW=1 git commit …',
  )
  console.log('')
}
function hookUninstall() {
  const target = path.resolve(flags.dir || '.')
  let removed = 0
  for (const name of Object.keys(GIT_HOOKS)) {
    const p = path.join(target, '.git/hooks', name)
    if (
      fs.existsSync(p) &&
      fs.readFileSync(p, 'utf8').includes(GIT_HOOK_MARK)
    ) {
      fs.rmSync(p)
      removed++
      ok(`removed .git/hooks/${name}`)
    }
  }
  if (!removed) info('no berserqir-managed git hooks found — nothing removed')
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
  if (modified.length)
    console.log(modified.map((r) => `      ! ${r}`).join('\n'))
  info(
    'preserved always: your memory files (memory-*.md/json, codemap, graph, human-profile, instincts, mcp-map), PRD/SPECS/TESTS/DESIGN',
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
  fs.rmSync(path.join(target, '.berserqir/update-check.json'), { force: true }) // runtime cache — never user work
  hookUninstall() // berserqir-managed git hooks are managed files too
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
    npx berserqir doctor  [--dir] [--fix]   Health check (zero-LLM); --fix applies mechanical repairs
    npx berserqir verify  [--dir]           Supply-chain check: package bytes vs the sealed witness + provenance + local drift
    npx berserqir hook-install [--dir]      Wire commit-quality as native git hooks (pre-commit + commit-msg)
    npx berserqir hook-uninstall [--dir]    Remove the berserqir-managed git hooks
    npx berserqir uninstall [--dir]   Remove managed files (memory/SDD preserved)
    npx berserqir version             Print version

  Options:
    --profiles <list>   Areas: ${AREAS.join(',')} · "full" = everything · "core" = core-only
    --dir <path>        Target repo (default: current directory)
    --harness <name>    Target harness: copilot | claude-code | cursor (omitted: detected from your IDE terminal + repo signals, then asked)
    --yes, -y           Accept detected defaults, skip confirmations
    --force             Overwrite files you modified since the last install
    --dry-run           Show the plan, write nothing
`)
}

;(async () => {
  if (cmd === 'install') await install()
  else if (cmd === 'update') await install({ isUpdate: true })
  else if (cmd === 'doctor') await doctor()
  else if (cmd === 'verify') await verify()
  else if (cmd === 'hook-install') hookInstall()
  else if (cmd === 'hook-uninstall') hookUninstall()
  else if (cmd === 'uninstall') await uninstall()
  else if (cmd === 'version' || cmd === '--version' || cmd === '-v')
    console.log(pkg.version)
  else help()
})().catch((e) => die(e.message || String(e)))
