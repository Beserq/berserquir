#!/usr/bin/env node
// Berserqir guardrail: git-safety
// Blocks publishing/destructive git actions unless the human explicitly authorized them.
// Zero dependencies, cross-platform (Node — no sh required).
//
// Input:  command string as argv[2], or on stdin.
// Output: exit 0 = allow · exit 2 = block (PreToolUse deny convention)
// Override (human-set, per command): BERSERQIR_GIT_ALLOW=1

import { readFileSync } from 'node:fs'

if (process.env.BERSERQIR_GIT_ALLOW === '1') process.exit(0)

let cmd = process.argv[2]
if (!cmd) {
  try {
    cmd = readFileSync(0, 'utf8')
  } catch {
    /* no stdin */
  }
}
if (!cmd || !cmd.trim()) process.exit(0)

// normalize whitespace for matching
const norm = cmd.replace(/\s+/g, ' ')

const block = (reason) => {
  process.stderr.write(
    `[berserqir:git-safety] BLOCKED: ${reason}\n` +
      'Publishing/destructive git actions require explicit human authorization.\n' +
      'If the human authorized it, re-run with BERSERQIR_GIT_ALLOW=1.\n',
  )
  process.exit(2)
}

if (/git push/.test(norm)) {
  if (/--delete/.test(norm)) block('deleting remote refs')
  block('git push — publishing (may trigger deploys)')
}
if (/git.*(--force-with-lease|--force)/.test(norm))
  block('forced git operation')
if (/git.*--no-verify/.test(norm))
  block('--no-verify — bypassing hooks/checks is forbidden')
if (/git reset.*--hard/.test(norm))
  block('git reset --hard — destructive on shared history')
if (/git clean -\w*f/.test(norm))
  block('git clean -f — deletes untracked files (possible in-progress work)')
if (/git branch -D/.test(norm)) block('git branch -D — force-deleting a branch')

process.exit(0)
