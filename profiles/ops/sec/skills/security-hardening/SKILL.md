---
name: security-hardening
description: Implementation-side security discipline — headers, dependencies, secrets, authz. Load for hardening work (sec-ops domain).
---

# Skill: Security Hardening

Implementation counterpart to the `security` gate's review checklist. Stack specifics from `memory-long §stack`.

## Baseline (verify, then harden)

- **Headers**: CSP (start restrictive, loosen with justification), HSTS, X-Content-Type-Options, frame-ancestors, referrer-policy · CORS: explicit origins, never `*` with credentials
- **Secrets**: env/secret-manager only · rotation path documented · never in logs, errors, or client bundles · secret-scan hook is the last line, not the first
- **Dependencies**: advisories triaged by exploitability-in-context, not just severity score · lockfiles committed · unused deps removed (attack surface)
- **AuthZ**: checked per-operation server-side; client-side checks are UX, never security · deny by default
- **Release channel** (the repo itself is attack surface): default branch rejects history rewrites (force-push) and deletion · release tags/branches creatable only by maintainers — if a tag triggers publishing, tag creation IS release authorization · publish pipeline gated on green checks, publishing with red or pending checks impossible · publish credentials are scoped automation tokens (never personal, never in code) · artifact provenance/signing on where the registry supports it. The principle is forge-agnostic; verify with the project's forge (GitHub rulesets: `gh api repos/<o>/<r>/rulesets` · GitLab protected branches/tags · etc.) and cite the API evidence in the review, not assumptions

## Patterns

- Fixes follow **expand-contract** when they touch running behavior (harden without breaking, verify, then enforce)
- Every hardening change ships with a test proving the block works (request that should fail, fails)
- Rate limiting on auth endpoints and expensive operations · timing-safe comparisons for secrets

## Verification

qa gate re-runs affected suites (hardening that breaks functionality is a regression) · security gate cross-reviews (different instance/family than the implementer) · report lists residual risk honestly.
