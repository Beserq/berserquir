---
name: anti-slop
description: Anti-generic-AI design discipline — bans, tells, and the slop test. Load for ANY new UI surface or visual redesign. Inspired by Impeccable (Apache 2.0).
---

# Skill: Anti-Slop

**The test: if someone could look at the interface and say "AI made that" without doubt, it failed.** Committed design choices over safe defaults. Project visual identity from `memory-long §conventions` + design tokens.

## Absolute bans (match-and-refuse — rewrite the element)

- **Side-stripe borders** (`border-left` >1px as colored accent on cards/alerts) → full borders, bg tints, leading icons, or nothing
- **Gradient text** (`background-clip: text`) → solid color; emphasis via weight/size
- **Glassmorphism as default** → rare and purposeful, or nothing
- **Hero-metric template** (big number + small label + gradient accent) — SaaS cliché
- **Identical card grids** (icon + heading + text × N, same size forever)
- **Tracked-uppercase eyebrow above every section** ("ABOUT" / "PROCESS" kickers) — one deliberate kicker is voice; one per section is AI grammar
- **Numbered section scaffolding (01/02/03) by reflex** — numbers only when the content IS a real sequence
- **Purple-to-blue gradients + ✨ emoji + "Powered by AI" pills** — the 2024-25 tell trifecta
- **Warm-neutral cream/sand/beige body bg as "warmth"** — carry warmth via accent, typography and imagery; body bg is a committed choice

## Category-reflex check (two altitudes)

1. **First-order**: can someone guess the palette from the category alone (fintech→navy, health→teal, AI→purple)? That's the training-data reflex — rework.
2. **Second-order**: can they guess your "alternative" from category + anti-reference ("AI tool but not SaaS-cream → editorial-typographic")? The trap one tier deeper — rework until neither is obvious.

## Commitment axis (pick a color strategy BEFORE colors)

**Restrained** (neutrals + one accent ≤10%) · **Committed** (one saturated color at 30–60%) · **Full palette** (3–4 named roles) · **Drenched** (the surface IS the color). Products default restrained; brand pages commit harder. Never drift between strategies mid-project.

## Dark vs light is never a default

Write one sentence of physical scene (who uses it, where, under what light, in what mood) — if the sentence doesn't force the answer, it's not concrete enough yet.

## Verification

Review any new surface against the bans list explicitly · heading copy tested at every breakpoint (overflow = design bug) · when in doubt, the human decides the identity call — propose 2 committed directions, never 1 safe one.
