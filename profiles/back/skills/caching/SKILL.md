---
name: caching
description: Caching discipline — invalidation, TTLs, stampede protection, layer choice. Load before adding any cache; caching is a bug you choose deliberately.
---

# Skill: Caching

Cache tech from `memory-long §stack`. A cache is **deliberately serving stale data for speed** — every decision below is about controlling how wrong you're willing to be.

## Before caching anything

1. Prove the problem: measure first — cache added without a measured hot path is complexity without evidence (see `performance-cwv` for the front-side counterpart).
2. Answer in writing (report/ADR): what's the acceptable staleness? What invalidates it? What happens on a miss storm? No answers = no cache.

## Invalidation (the famous hard problem)

- **TTL is the safety net, not the strategy** — every entry has one (nothing cached forever), but correctness comes from explicit invalidation on write paths.
- Invalidate by **key discipline**: keys are structured and enumerable (`user:{id}:orders`), so write paths can target them — regex-sweeping a cache is a smell.
- **Never cache-then-write**: update source of truth first, then invalidate (not update) the cache — deleting is idempotent, rewriting races.

## Stampede protection

Popular key expires → N requests hit the source simultaneously. Pick one: request coalescing/locking (one refills, others wait) · probabilistic early refresh · stale-while-revalidate. Default: SWR where user-facing, locking where the source is fragile.

## Layer choice

In-process (fastest, per-instance drift) → shared/distributed (consistent, network hop) → CDN/edge (for anonymous/static). Cache as close to the consumer as staleness tolerance allows. **Never cache**: authz decisions, feature flags mid-request, anything with per-user secrets in a shared layer.

## Verification

Hit ratio and staleness metrics visible (see `observability`) · test the failure modes: cold cache, miss storm, invalidation race · report states the staleness contract explicitly.
