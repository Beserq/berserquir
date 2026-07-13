#!/usr/bin/env node
// Vendors canonical sources (core/, profiles/, adapters/) into the installer package
// at pack time, so the published tarball is self-contained. Removed after pack.
// Also seals the witness: a per-file sha256 ledger of everything that ships.
// The tarball is covered by the npm --provenance attestation (Sigstore, keyless),
// so the sealed ledger is transitively signed — `npx berserqir verify` closes
// the chain on the user's side. Zero dependencies.
import {
  cpSync,
  rmSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..') // installer/
const monoRoot = join(pkgRoot, '..') // berserqir/ (monorepo)
const DIRS = ['core', 'profiles', 'adapters']

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })

const mode = process.argv[2]
if (mode === 'vendor') {
  for (const d of DIRS) {
    const src = join(monoRoot, d)
    if (!existsSync(src)) {
      console.error(`[pack] missing ${src} — must pack from the monorepo`)
      process.exit(1)
    }
    rmSync(join(pkgRoot, d), { recursive: true, force: true })
    cpSync(src, join(pkgRoot, d), { recursive: true })
  }
  // LICENSE: npm auto-includes it from the package root — vendor from the monorepo
  if (existsSync(join(monoRoot, 'LICENSE')))
    cpSync(join(monoRoot, 'LICENSE'), join(pkgRoot, 'LICENSE'))
  // seal the witness: sha256 of every shipped file (witness.json excluded from itself)
  const pkgJson = JSON.parse(
    readFileSync(join(pkgRoot, 'package.json'), 'utf8'),
  )
  const files = {}
  const roots = ['bin', ...DIRS].map((d) => join(pkgRoot, d))
  for (const r of roots)
    if (existsSync(r))
      for (const f of walk(r))
        files[relative(pkgRoot, f).split('\\').join('/')] = createHash('sha256')
          .update(readFileSync(f))
          .digest('hex')
  for (const single of ['LICENSE', 'package.json'])
    if (
      existsSync(join(pkgRoot, single)) &&
      statSync(join(pkgRoot, single)).isFile()
    )
      files[single] = createHash('sha256')
        .update(readFileSync(join(pkgRoot, single)))
        .digest('hex')
  writeFileSync(
    join(pkgRoot, 'witness.json'),
    JSON.stringify(
      {
        version: pkgJson.version,
        sealedAt: new Date().toISOString(),
        algorithm: 'sha256',
        files,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(
    `[pack] vendored: ${DIRS.join(', ')}, LICENSE · witness sealed (${Object.keys(files).length} files)`,
  )
} else if (mode === 'clean') {
  for (const d of DIRS)
    rmSync(join(pkgRoot, d), { recursive: true, force: true })
  rmSync(join(pkgRoot, 'LICENSE'), { force: true })
  rmSync(join(pkgRoot, 'witness.json'), { force: true })
  console.log(`[pack] cleaned: ${DIRS.join(', ')}, LICENSE, witness.json`)
} else {
  console.error('usage: node scripts/pack.mjs vendor|clean')
  process.exit(1)
}
