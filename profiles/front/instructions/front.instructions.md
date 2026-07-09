---
description: Frontend area rules — auto-applied when editing components, pages and styles. Stack-agnostic; idioms from memory-long §stack.
applyTo: "**/components/**,**/pages/**,**/layouts/**,**/styles/**,**/assets/css/**"
---

# Frontend Rules (always-on for matching files)

1. Typed component contracts in the project's type system — no untyped boundaries. Framework idioms come from `memory-long §stack`, not from assumption.
2. Styling via the project's design tokens only. **`DESIGN.md` at the repo root is the project's visual truth** — tokens, type scale, component inventory (reuse before creating), voice, project bans. **Verify token VALUES in the token source — names lie** (Name ≠ Value rule). No ad-hoc values. No DESIGN.md yet? Propose seeding it (`/berserqir init`).
3. Mobile-first; test 375×812; click/tap primary, hover = progressive enhancement.
4. `prefers-reduced-motion` handling is mandatory for any animation.
5. WCAG 2.1 AA floor: 4.5:1 contrast, focus-visible states, semantic HTML before divs, alt text.
6. Server/static-render safe: browser APIs only behind client guards; no hydration mismatches.
7. CWV budgets bind (see `performance-cwv` skill) — never relax a budget to pass.
8. Deep dives on demand: `.github/skills/component-patterns`, `styling-discipline`, `performance-cwv`.
