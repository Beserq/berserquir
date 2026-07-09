---
name: kubernetes
description: Kubernetes workload discipline — probes, resources, RBAC, disruption budgets. CNCF standard, not vendor; cluster provisioning belongs to infra.
---

# Skill: Kubernetes

K8s is a CNCF open standard — ubiquitous enough to be discipline, not vendor. **Boundary**: workload operation lives here (dev-ops); cluster lifecycle/provisioning is infra (`platform-architecture`, `infra-patterns`). Managed-flavor specifics from `memory-long §stack`.

## Workload non-negotiables

1. **Requests and limits on every container** — no requests = scheduler flying blind = noisy-neighbor outages; memory limit ≈ request (OOMKill beats node eviction), CPU limit optional-by-policy (throttling trade-off documented).
2. **Liveness ≠ readiness**: liveness = "restart me" (deadlock detection ONLY — a liveness probe hitting the DB restarts your app when the DB blips) · readiness = "don't route to me yet" (dependencies belong here) · startup probes for slow boots instead of generous liveness delays.
3. Deployments declarative via GitOps (see `gitops`) — `kubectl edit/apply` by hand in prod = drift incident · rollout strategy explicit (maxSurge/maxUnavailable are release-engineering choices).
4. **PodDisruptionBudgets on anything that matters** — node drains and upgrades WILL happen; a PDB is how your availability survives ops (see `resilience`).

## Isolation & access

Namespaces are the unit of tenancy: quotas + RBAC + network policies per namespace · **RBAC least-privilege per service account** — no default SA with permissions, no cluster-admin for workloads, ever (see `infra-security` identity rules) · NetworkPolicies deny-by-default east-west (see `network-design`) · secrets as mounted refs from a real secret store, not bare base64 manifests in git.

## State & scaling

Stateless by default; StatefulSets only for genuinely stateful workloads (and prefer managed data services — running databases on k8s is an ADR, not a habit) · HPA on metrics that mean something (queue depth > CPU for workers) · **anti-affinity for replicas of the same service** — three replicas on one node is one replica with extra steps.

## Verification

`kubectl diff`-style dry-run in CI before any manifest merges · new workload checklist: probes, resources, PDB, SA, network policy, non-root (see `containers`) · post-deploy: rollout status + RED metrics green before the report closes (see `observability`).
