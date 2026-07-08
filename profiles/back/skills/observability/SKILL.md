---
name: observability
description: Observability discipline — structured logs, correlation, metrics, actionable alerts. Load when adding logging, metrics or diagnosing production behavior.
---

# Skill: Observability

Stack tooling from `memory-long §stack`; the discipline is universal: **if you can't explain what the system did from its telemetry, you don't have observability — you have vibes.**

## Logging

1. **Structured (JSON), never string-interpolated prose** — fields are queryable, sentences aren't. Level discipline: `error` = human must act · `warn` = degraded but handled · `info` = state change worth auditing · `debug` = off in prod by default.
2. **Correlation ID on every request** — generated at the edge, propagated through every service call, job and queue message. A log line without correlation is an orphan.
3. **Never log**: PII (see `data-safety`), secrets/tokens, full request bodies. Log the *shape* of a failure (ids, codes, counts), not the payload.
4. Errors logged **once, at the boundary that handles them** — re-logging at every layer is noise that buries the signal.

## Metrics (RED as the floor)

Per endpoint/consumer: **R**ate, **E**rrors, **D**uration (p50/p95/p99 — averages lie). Plus queue depth/age for async work and business counters that matter to the PRD (signups, orders — the metrics the humans actually watch).

## Alerts

**Actionable or nonexistent**: every alert names its runbook/next action; alerts nobody acts on get deleted, not muted. Alert on symptoms (user-facing error rate, latency), not causes (CPU%) — causes go on dashboards. Page thresholds = sustained breach, not single spikes.

## Verification

New endpoint/job ships with: correlation propagated, RED visible, failure path emits the right level. Report includes "how we'll know it's broken in prod" — a feature without that sentence isn't done.
