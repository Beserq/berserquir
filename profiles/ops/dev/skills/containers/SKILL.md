---
name: containers
description: Container discipline — OCI images, runtime hygiene, security posture. Open standard (OCI), not vendor; registry/runtime from memory-long §stack.
---

# Skill: Containers

OCI is an open spec — this discipline holds on any runtime. Expands the container rules in `ops-dev` instructions.

## Image discipline

1. **Multi-stage always**: build stage fat, runtime stage minimal (distroless/slim/alpine-class) — the runtime image contains what runs, nothing that builds.
2. **Pin by digest** for bases in production paths (`image@sha256:...`) — tags mutate, digests don't; `:latest` anywhere in a deployable manifest fails review.
3. Layer economics: order Dockerfile from least- to most-frequently-changing (deps before source) — cache hits are build speed · one concern per image (no "app + cron + nginx" bundles).
4. **Nothing secret in layers**: no secrets in build args that persist, no `.env` COPYed, no private keys "removed" in a later layer (layers are forever — use build secrets/mounts).

## Runtime hygiene

**Non-root user, read-only root filesystem where possible, no privileged mode without an ADR** · one process per container; init/tini for zombie reaping when needed · logs to stdout/stderr (the platform collects — see `observability`), never files inside the container · healthcheck defined (the orchestrator's probes build on it — see `kubernetes`) · resource expectations documented: what it needs at idle and under load (feeds requests/limits).

## Supply chain

Images scanned in the pipeline (fail on critical, triage by exploitability per `security-hardening`) · SBOM generated where tooling allows · only approved registries; third-party images pinned and mirrored, not pulled live from the internet at deploy time.

## Verification

Image builds reproducibly in CI (not on laptops) · size tracked — unexplained growth is a smell · `docker run` locally with the documented env = works (the container IS the contract).
