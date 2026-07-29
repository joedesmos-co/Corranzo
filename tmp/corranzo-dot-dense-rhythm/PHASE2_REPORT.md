# Phase 2 — Hungarian Dense Eighth/Sixteenth → Quarter

**Baseline:** `541f607e230611e37f377f4a106f42ab57822c65`  
**Fantaisie tempo:** frozen — not modified  
**Verdict: REVERTED** (no production changes retained)

## Verified case-set

Artifacts: `phase2-hungarian/VERIFIED_CASES.json`, `page1-measure-rhythm-beams.json`,
`override-provenance.json`, `hungarian-baseline.musicxml`.

| Metric (baseline) | Value |
|---|---|
| Verified short→quarter promotions | **30 / 55** |
| Verified correct short | **9 / 55** |
| Truth vs gen beamed notes (m1–55) | **328** vs **39** |
| Full-piece types | Q **800** / 8th **431** / 16th **108** |
| Page-1 beamed events stuck as quarter | **62** (with note-level beams often already set) |

## First failing stage

1. **Beam never attached** for most truth beamed notes (dominant).
2. When `beams ≥ 1` exists: **event duration stays/returns to quarter** via gap packing,
   `coalesceSameOnsetChordEvents` `Math.max`, and/or `denseMeasure` skipping beam refine;
   late stages can overwrite caps without flags.

## Attempted approaches

| Approach | HU verified | Controls | Decision |
|---|---|---|---|
| Beam-aware coalesce + dense re-refine + open refuse beam-cap | promo **30→31** (no gain); 16th 108→134 | EV `quarter.=15` OK; MC `quarter.=17`/whole `144` but eighth **49→34** | **Reverted** |
| Broad late refine whenever beams (prior) | promo 30→13 | **Breaks** Minecraft Phase 1 | Rejected |

## Acceptance

| Bar | Result |
|-----|--------|
| Material eighth/sixteenth recall | **Fail** on safe path |
| Minecraft Phase 1 intact | Eighth inventory regression on coalesce path |
| No event thinning / no grid force-fit | Honored |
| Evangelion stable | OK on coalesce-only path; not enough HU gain |

## Production decision

Fully reverted to `541f607`. Hungarian **not** claimed fixed.

## Remaining path

Improve beam **attachment / confidence evidence** so dense 2/4 filled heads get reliable
`beams ≥ 1` without false hits on sparse Minecraft open/dotted values — then a late
beam-cap can land under the existing dense gate. Do not lower the 0.9 topology threshold.
