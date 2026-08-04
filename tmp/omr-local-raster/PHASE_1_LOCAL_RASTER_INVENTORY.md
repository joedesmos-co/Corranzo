# Phase 1 — Local raster notehead failure inventory

- Commit: `beeb5f0`
- Created: 2026-08-02T01:38:23.640Z
- Evaluator: frozen 2.0.0 / schema 2
- Production code: **not modified**
- Optical profile: **disabled**
- Vector fragment clustering: **removed / not present**

## Cleanup confirmation

- Production HEAD: `beeb5f0`
- `pitchFromStaffPosition.js` matches HEAD (no local diff)
- Rejected `noteheadFragmentCluster.js` and its unit tests deleted
- Prior report preserved: `tmp/omr-head-components/HIGH_EXTREME_COMPONENT_RECOVERY_REPORT.md`

## Scope

Every generated note with `noteheadAnchor.rejectedReason === no-head-sized-component` on the frozen nine-fixture corpus, plus a proposed local raster crop in staff spaces.

## Scoreboard

- Total no-head-sized rejections: **226**
- High-extreme subset: **7**
- Crops with recoverable ink at analysis resolution: **224**
- Empty / near-empty crops: **0**

## Proposed crop design (not implemented)

| Parameter | Value |
|---|---|
| Extents (staff spaces) | L 0.55 / R 1.35 / above 1.25 / below 0.45 |
| Target px / staff space | 28 |
| Max crop side (px) | 220 |
| Mean proposed crop W×H | 57.1 × 52.2 |
| Mean local scale vs analysis | 2.096× |
| Analysis page width | 1000px |

## By raster case group

| Group | Count |
|---|---:|
| `filled-notehead-under-ledger-lines` | 128 |
| `stacked-chord-heads` | 80 |
| `notehead-adjoining-stem` | 16 |
| `non-note-artifact-correctly-rejected` | 2 |

## By register

| Register | Count |
|---|---:|
| `high-normal` | 141 |
| `low-normal` | 63 |
| `middle` | 13 |
| `high-extreme` | 7 |
| `low-extreme` | 2 |

## By fixture

| Fixture | Count |
|---|---:|
| `piano-dense-advanced-vector` | 118 |
| `guitar-standard-chords-vector` | 42 |
| `guitar-paired-chords-vector` | 36 |
| `piano-grand-voices-vector` | 16 |
| `piano-rhythm-tuplets-vector` | 12 |
| `guitar-techniques-paired-vector` | 2 |

## High-extreme sample (crop proposals)

| Fixture | M | Group | Gap px | Crop W×H @target | Scale | Ink px | Recoverable | Generated |
|---|---:|---|---:|---|---:|---:|---|---|
| piano-dense-advanced-vector | 7 | stacked-chord-heads | 13.3 | 57×51 | 2.113 | 278 | yes | G#5 |
| piano-dense-advanced-vector | 8 | notehead-adjoining-stem | 13.3 | 57×51 | 2.113 | 427 | yes | G#5 |
| piano-dense-advanced-vector | 8 | stacked-chord-heads | 13.3 | 57×53 | 2.113 | 301 | yes | A#5 |
| piano-dense-advanced-vector | 8 | filled-notehead-under-ledger-lines | 13.3 | 57×51 | 2.113 | 388 | yes | G#5 |
| piano-dense-advanced-vector | 9 | filled-notehead-under-ledger-lines | 13.3 | 57×51 | 2.113 | 358 | yes | G5 |
| piano-dense-advanced-vector | 9 | filled-notehead-under-ledger-lines | 13.3 | 57×53 | 2.113 | 326 | yes | A#5 |
| piano-dense-advanced-vector | 9 | filled-notehead-under-ledger-lines | 13.3 | 57×51 | 2.113 | 334 | yes | G#5 |

## Cost sketch (design)

- Rasterize **only** when ordinary + ledger-masked vector ink fail with `no-head-sized-component`.
- Prefer one page-level supersampled render (or tile cache) shared by nearby candidates — not one full-page render per note.
- Bound crop side to ≤ 220px at target scale; bound candidates/page (suggested ≤ 64 recoverable crops).
- Estimated memory per crop ≈ `W×H×4` bytes at target scale (mean crop ~ mean W×H above).

## Next (Phase 2)

Design local crop/cache infrastructure only after reviewing this inventory; do not land recognition changes until crop design is accepted.

