---
name: infra-patterns
description: Infrastructure composition patterns — immutable infra, GitOps, golden images, cattle-not-pets, day-2 thinking. Tool-agnostic.
---

# Skill: Infra Patterns

The structural patterns layer for infra — counterpart to back's `design-patterns`. Tooling from `memory-long §stack`.

## Immutable over mutable

**Replace, don't patch**: config changes produce new instances/images, deployed by replacement — SSH-ing into a server to fix it creates a snowflake nobody can rebuild · golden images built by pipeline (versioned, scanned, minimal) · if you must mutate (legacy), record it as DEBT-* with a path to immutability.

## Cattle, not pets

Anything you'd grieve is a liability: no named, hand-raised servers · every resource rebuildable from code + data restore (the real test: "could we recreate this from the repo?" — if no, it's not IaC yet, it's documentation) · singletons that can't be replaced get an ADR explaining why.

## GitOps (declarative + reconciliation)

Desired state lives in git; the runtime converges toward it · **drift is a signal, not noise**: detected drift either becomes code (someone had a reason) or gets reverted (nobody did) — never ignored · manual console changes in prod = incident-grade event, not convenience. Deep dive: `gitops` skill (ops/dev owns the practice).

## Composition

Layers with clear ownership: foundation (network/identity/logging — changes rarely, guarded hard) → platform (clusters, shared services) → workload (per-app, changes often) · **blast-radius-ordered state**: don't put fast-changing workload resources in the same state/stack as the foundation (see `state-discipline`) · environments composed from the same modules with different inputs — never forked copies.

## Day-2 is the design input

Provisioning is day 0; the pattern must answer day 2: how does it upgrade? · how is it observed? (see `observability` principles) · how does it scale? · how is it decommissioned cleanly (orphaned dependencies = cost + attack surface)? A pattern without upgrade + teardown stories is half-designed.

## Verification

New patterns prove rebuildability (fresh env from scratch in CI when feasible) · pattern changes propagate via module version bumps, tracked per environment · report names which layer the change belongs to and its blast radius.
