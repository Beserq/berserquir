#!/usr/bin/env node
// Berserqir guardrail: config-protection
// Blocks agent edits to lint/test/quality configs — fixing code by weakening the
// ruler is forbidden (ECC-verified failure mode).
// Zero dependencies, cross-platform (Node — no sh required; handles \ and / paths).
//
// Input:  target file path as argv[2], or on stdin.
// Output: exit 0 = allow · exit 2 = block
// Override (human authorized a legitimate config change): BERSERQIR_CONFIG_ALLOW=1

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

if (process.env.BERSERQIR_CONFIG_ALLOW === '1') process.exit(0)

let target = process.argv[2]
if (!target) {
  try {
    target = readFileSync(0, 'utf8').trim()
  } catch {
    /* no stdin */
  }
}
if (!target) process.exit(0)

const posix = target.replaceAll('\\', '/') // Windows paths normalize to /
const base = basename(posix)

const block = (kind) => {
  process.stderr.write(
    `[berserqir:config-protection] BLOCKED: edit to ${base} (${kind}).\n` +
      'Fix the code, not the ruler. If the human authorized this config change, re-run with BERSERQIR_CONFIG_ALLOW=1.\n',
  )
  process.exit(2)
}

const RULES = [
  [/^\.eslintrc(\..+)?$|^eslint\.config\./, 'lint config'],
  [/^biome\.jsonc?$/, 'lint/format config'],
  [/^\.prettierrc(\..+)?$|^prettier\.config\./, 'format config'],
  [/^tsconfig(\..+)?\.json$/, 'TypeScript strictness config'],
  [/^\.?ruff\.toml$/, 'lint config'],
  [/^(jest|vitest|playwright)\.config\./, 'test config'],
  [/^\.golangci\.ya?ml$/, 'lint config'],
]
for (const [re, kind] of RULES) if (re.test(base)) block(kind)

if (
  posix.includes('/.github/workflows/') ||
  posix.startsWith('.github/workflows/')
)
  block('CI workflow')

process.exit(0)
