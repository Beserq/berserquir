---
name: gitops
description: GitOps discipline — desired state in git, reconciliation, drift semantics, environment promotion. Tool-agnostic (works with any reconciler).
---

# Skill: GitOps

Owned by dev-ops; deep-dive of the GitOps summary in `infra-patterns`. Reconciler tooling from `memory-long §stack`.

## The contract

**Git is the only write path to the runtime.** Desired state lives in a repo; a reconciler converges the runtime toward it continuously. Consequences that must hold:
- Rollback = `git revert` (which makes the `release-engineering` one-command rollback real for infra/workloads)
- Audit = git history (who, what, why — commits carry anchors per `git-workflow`)
- Disaster recovery = point the reconciler at the repo (rebuildability — see `infra-patterns` cattle test)

## Drift semantics

Detected drift is a **decision, not noise**: either someone had a reason (→ codify it, PR it) or nobody did (→ auto-revert). Reconcilers in enforce mode for prod, notify mode acceptable in sandboxes only · manual mutation in prod = incident-grade event · drift dashboards reviewed on cadence, not on curiosity.

## Environment promotion

Same manifests, different overlays/values per env — **never forked env branches that drift apart** · promotion is a PR moving a version/digest from staging values to prod values (reviewable, revertible, anchored) · app code and deployment manifests in separate repos or clearly separated paths — app CI shouldn't be able to mutate prod desired state directly.

## Secrets in a git-driven world

Never plaintext in the repo, obviously — sealed/encrypted-at-rest references or external secret-store pointers · the reconciler's own credentials are the crown jewels: scope per-namespace/env, rotate, audit (see `infra-security` identity rules).

## Verification

Prod state diff against git = empty (checked on schedule) · a change can be traced: PR → commit → reconcile event → runtime · freshly bootstrapped env from repo alone succeeds (the ultimate test, run in CI when feasible).
