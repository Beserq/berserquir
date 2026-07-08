---
name: async-jobs
description: Background work discipline — queues, retries, idempotency, delivery semantics. Load for any job, queue, webhook or scheduled work.
---

# Skill: Async Jobs

Queue/scheduler tech from `memory-long §stack`. The failure modes are universal — async work fails in ways sync code never does, and it fails silently.

## The three laws

1. **Every job is idempotent** — at-least-once delivery is the realistic default everywhere, so processing twice must equal processing once (idempotency keys, upserts, conditional writes).
2. **Every retry has a budget and a backoff** — exponential + jitter, capped attempts. Infinite retries turn one poison message into an outage.
3. **Every queue has a DLQ** (dead-letter) **that a human watches** — a DLQ nobody monitors is a data-loss buffer with extra steps. DLQ entries carry enough context to replay.

## Patterns

- **Outbox for DB+queue atomicity**: never write to the database and publish to a queue as two separate operations — write the event to an outbox table in the same transaction, relay it separately.
- **Job payloads are references, not snapshots**: pass ids and re-fetch fresh state at execution time — a job executing minutes later against stale data corrupts.
- Timeouts on the job AND on every external call inside it · long jobs checkpoint or split · scheduled jobs assume they can overlap with themselves (lock or skip).
- **Webhooks (inbound)**: verify signatures, respond fast (enqueue, don't process inline), tolerate duplicates and out-of-order delivery.

## Ordering

Assume unordered unless the infrastructure explicitly guarantees it AND you've read the fine print (partition/group scope). Design for commutativity where possible; sequence numbers where not.

## Verification

Test the failure paths, not just success: duplicate delivery, mid-job crash + retry, poison message → DLQ. Queue depth/age metrics visible (see `observability`) before the feature ships, not after the first incident.
