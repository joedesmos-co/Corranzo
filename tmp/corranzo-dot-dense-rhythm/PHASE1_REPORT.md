# Phase 1 — Minecraft Dot Attachment / Open Noteheads

**Baseline:** `541f607e230611e37f377f4a106f42ab57822c65`  
**Fantaisie tempo:** frozen / seek-validated (84→50→108→168) — not modified  
**Verdict: REVERTED** (no production changes retained)

## Verified case-set

Artifacts: `phase1-minecraft/CASESET_SUMMARY.json`, `dyfail-chord-band-rca.json`,
`truth-vs-gen.json`.

| Signal | Value |
|--------|-------|
| PDF whole glyphs | **165** (= truth wholes) |
| Gen wholes @ baseline | **144** |
| PDF rhythm dots | **133**; matched **66**; unmatched **67** (`dyFail` 57) |
| Near-miss cluster | dx≈11.25, dy≈4.17 vs gate 4 (Δ≈0.17) |
| Truth dotted quarters | ~**49**; gen **17** |
| Whole glyphs in events | 163 tracked; **126** stay whole; rest collapse to half/quarter/eighth via gap packing |

## First failing stages

1. **Dots:** `isAugmentationDotRelativeToNote` rejects Δdy≈0.17 near-misses. Evangelion has the **same** 0–0.25 Δ bucket (~104 on first pages) — any dy epsilon or unconstrained column band also rescues Evangelion false dots.
2. **Open noteheads:** vector `noteheadGlyph: 'whole'` is correct at enrich (`durationDivisions: 16`), but **dense** `buildNoteEventsFromGroups` skips glyph-authoritative duration (`if (!denseMeasure)`), so X-gap / false beams collapse wholes.

## Attempted approaches

| Approach | MC | Evangelion | Decision |
|---|---|---|---|
| Global / epsilon dy loosen | would recover near-misses | same cluster → false dots | Rejected |
| Sparse-only dy (prior campaign) | quarter. 17→21; wholes 144 | ≈OK | Below bar |
| Dense glyph-auth for whole/half + refuse beam-cap on open | wholes 144→**146** only; eighth inventory down | `quarter.` 15→**16**, half 14→**34** | **Reverted** |

## Acceptance

| Bar | Result |
|-----|--------|
| Material dotted-quarter recall beyond 17/49 | **Fail** (no safe dy path) |
| Wholes recover from 144 | **Fail** (+2 only; EV broken) |
| Evangelion unchanged | **Fail** under glyph-auth dense |

## Production decision

Fully reverted to `541f607`. Fantaisie tempo untouched.

## Remaining path

Dots need staff-local onset ownership that **discriminates** Minecraft engraving from Evangelion packed false near-misses — not a wider `dy`. Wholes need glyph auth that does not inflate Evangelion hollow/half false positives on dense filled textures.
