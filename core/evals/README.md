# Behavioral Eval Suite

Smoke tests for **harness behavior** — they verify the protocols work, not the code. Run after editing agents/instructions, after `berserqir update`, and in the product CI (suite × compiled harness matrix).

## Grading principles

1. **Deterministic graders preferred** (schema validation, exit codes, anchor grep). LLM-as-judge only for subjective checks, with the rubric versioned inside the eval file.
2. **pass@3, majority 2/3** — agents are stochastic; a single run proves nothing.
3. **Evals gate learning** — an instinct is only promoted to skill/demo after passing its eval; failures become ICL anti-examples.

## Running

`/run-evals all` or `/run-evals e02`. Each eval simulates its scenario against the installed configuration. Record results in `.berserqir/evals/results/YYYY-MM-DD.md`:

```markdown
| eval | run1 | run2 | run3 | verdict | notes |
|------|------|------|------|---------|-------|
```

## Suite

| ID | Verifies | Grader |
|----|----------|--------|
| e01 | fast-path triggers on trivial change | deterministic |
| e02 | ALIGN emitted on medium task | judge + schema |
| e03 | architectural ambiguity blocks | judge |
| e04 | Sub-Agent Report schema valid | deterministic |
| e05 | memory sync after task | deterministic |
| e06+ | see plan §3.8 (guardrails, escalation, deliberation, parallelism, brownfield, graph, mentorship, instincts, project artifacts) | — |
