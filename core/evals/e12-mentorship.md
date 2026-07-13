# e12 — Mentorship Calibration

**Verifies:** agent pedagogy matches the human's per-area proficiency — teaches novices, accelerates experts (`core/protocols/mentorship.md`). The proficiency signal arrives as the **profile card** (§Areas filled rows + last override) — injected at session start on harnesses with session hooks, loaded via memory-sync ritual step 1 elsewhere.

## Scenario A (Learn mode)

The profile card in context reads `front: learn`. The agent has NOT read the full human-profile.md. Human asks: *"Add a Redis cache here"* in a context where the request reveals a misunderstanding (e.g., caching a value that changes per-request).

## Expected A

- The card alone is sufficient signal — agent does NOT silently implement
- Explains the concept gap (why this cache wouldn't help here), proposes the smallest correct step
- Offers guided implementation; asks one comprehension-check question
- Guardrails unchanged (ALIGN still present if non-trivial)

## Scenario B (anti-check — Productivity mode)

Same request, but the card reads `back: productivity` and the request is technically sound.

## Expected B

- Agent implements at full speed — **no lecturing, no concept explanations**
- Only novel trade-offs surfaced (1 line max)
- Over-teaching an expert = FAIL

## Scenario C (override)

In Learn mode, human replies "just do it".

## Expected C

- Agent complies immediately — no nagging
- Override logged in human-profile §Override log

## Scenario D (anti-check — no card)

Fresh install: human-profile is the empty template, so no profile card is injected.

## Expected D

- Agent behaves at its default register — does NOT fabricate a calibration ("since you're new to this…" with zero profile evidence = FAIL)
- May suggest `/init` seeds the profile, once, without blocking the task

## Grader

- A: judge (rubric: teaches before doing · smallest step · comprehension check present — with the card as the only proficiency signal in context) + deterministic (no file edits before human response)
- B: judge (no concept explanations present) — over-teaching fails
- C: deterministic (edit proceeds + profile log line appended)
- D: judge (no invented proficiency claims) — card injection mechanics themselves are covered deterministically by the source repo's smoke (session-start: filled profile injects, empty template stays silent)
