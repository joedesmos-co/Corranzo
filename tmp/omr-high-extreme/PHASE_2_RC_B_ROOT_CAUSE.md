# Phase 2 — RC-B root cause (high-extreme pitch anchors)

- Commit: `f2d3f05`
- Baseline: `PHASE_1_HIGH_EXTREME_BASELINE.md` / `high_extreme_inventory.json`
- Crops: `crops/dense-m6-8-high-ledgers.png`, `crops/dense-m7-high-stack.png`, `crops/dense-m8-top-ledgers.png`
- Anchor probe: `diagnostics/anchor-probe-rows.json`, `diagnostics/dense-high-note-anchors.json`
- Production code: **not modified in Phase 2**

## Pipeline traced

```
PDF text notehead glyphs (SMuFL U+E0A4…)
  → textGlyphsToImage bounds (origin = glyph.x/y, often baseline-ish)
  → resolvePitchFromGrandStaff(yRough) for local lineYs
  → resolveNoteheadAnchor(glyph, imageData, lineYs)   ★ first failing function
       ├─ suppress long horizontal runs (staff + ledger ink)
       ├─ suppress tall vertical runs (stems)
       ├─ collectCompactRowComponents (bridge ±3px across suppressed rows)
       ├─ filter head-sized (width/gap ∈ [0.42,1.05], height/gap ∈ [0.22,0.70])
       ├─ reject if vertically competing heads (ambiguous-components)
       ├─ reject if none survive font-origin band (component-outside-font-origin-range)
       └─ else ink center; else glyph-metrics-fallback
  → resolvePitchFromGrandStaff(yNorm) → MIDI
  → chord column / accidental / rhythm packing → MusicXML
```

## Visual evidence

Dense treble chords on `piano-dense-advanced-vector` sit **several ledger lines above** the staff with:

- shared upward stems + beams through the stack
- short fragmented ledgers crossing every notehead body
- displaced seconds (small x offsets)
- accidentals left of stacks

Crops confirm mechanism candidates **5, 6, 7, 8, 12** from the campaign taxonomy (ledger confusion, shared/fallback anchors, stem-inclusive metric bounds). Wrong-staff and octave clamps are **not** observed in the high-extreme inventory (0/0).

## Quantitative anchor failure (high-extreme tones)

| Anchor outcome | Tone touches | On incorrect chords |
|---|---:|---:|
| `glyph-metrics-fallback/no-head-sized-component` | 28 | 20 |
| `glyph-metrics-fallback/ambiguous-components` | 19 | 17 |
| `glyph-metrics-fallback/component-outside-font-origin-range` | 5 | 5 |
| `ink-notehead-geometry` | 2 | 2 |

Ink success rate on high-extreme inventory tones: **2 / 54 ≈ 3.7%**.

Live probe on dense m5-area high glyphs (x>700, yNorm<0.23): same pattern — most `no-head-sized` or `ambiguous`, with `suppressedStaffOrLedgerRows` typically **3–5** and stem columns **1–14**.

When ink *does* succeed, center moves ~0.22 staff-spaces from metric (`usedStaffPos` can differ by 1 step from `metricStaffPos`). That is exactly the magnitude of many high-extreme pitch-set defects.

## First failing function and rule

**Function:** `resolveNoteheadAnchor` in `src/features/omr/pitchFromStaffPosition.js`

**Failing rules (in order):**

1. **Ledger-row suppression + head-size gate → `no-head-sized-component`**
   - Long horizontal ledger runs inside the glyph window are added to `suppressedRows`.
   - Notehead ink crossing those rows is deleted or shredded; remaining blobs fail `heightRatio ∈ [0.22, 0.70]`.
   - Fallback uses `resolveMetricNoteheadYNorm` (glyph baseline + small height factor). Metric is consistently ~0.32 spaces below raw `glyph.y` and often **one diatonic step** off the true head center under dense ledgers.

2. **Stacked chord heads in one window → `ambiguous-components`**
   - Neighbor chord tones (and occasionally displaced seconds) survive as multiple head-sized components with Δy ∈ [0.35, 1.25] gaps and similar x.
   - Current rule **abandons all ink** and falls back to metrics instead of picking the component nearest the glyph’s own origin.
   - Existing unit test `rejects ambiguous stacked heads` currently encodes this reject-as-fallback behavior.

3. **Surviving blobs outside font-origin band → `component-outside-font-origin-range`**
   - After ledger/stem suppression, the remaining component’s `(xOriginOffset, yOriginOffset)` miss the Bravura-like band `[−0.32,0.95] × [0.45,1]`.

## Mechanism classification (this campaign)

| # | Mechanism | Role in high-extreme |
|---:|---|---|
| **8** | Extreme note snapped to wrong staff step via metric fallback | **Primary** |
| **12** | Stem/glyph-inclusive metric bounds | Contributes whenever ink rejects |
| **5/6** | Ledger fragments treated as suppressible “staff” rows | **Primary enabler** of (1) |
| **7** | Several chord tones sharing one fallback path | Via (2) ambiguous reject |
| **15** | Accidental gaps | Secondary (±1) on some rows; do not invent alters |
| **13** | Chord column issues | 2 of 17 incorrect (`chord_column_grouping`) — after anchors |
| **10 / 14** | Wrong staff / evaluator | Not evidenced (0 wrong-staff; defects are local pitch-set) |

## Exact RC-B statement

Under dense upper-ledger geometry, **font-aware ink anchoring rejects the true notehead body** (`no-head-sized-component` / `ambiguous-components`), so pitch falls back to **glyph-metric Y**, which is unstable several ledger lines above the staff and mis-quantizes stacked chord tones by about one staff step. That is the first failing stage for high-extreme exact-chord accuracy (15%).

## What not to change yet

- RC-A ledger MIDI window / gap×8 measure+orphan pads
- Recovered-tone rhythm integration / sparse chord packing
- Ghost-staff rejection
- Microphone paths
- Accidental invention / harmonic plausibility
- Broad chord-ownership rewrite before anchors are fixed

## Phase 3 intervention target

Smallest general correction at `resolveNoteheadAnchor`:

1. When multiple vertically stacked head-sized components exist, **select the component nearest the glyph metric/font origin** (preserve per-glyph centers; do not merge chord tones).
2. When ledger suppression yields `no-head-sized-component`, **retry ink in a tight band around the metric center** without suppressing ledger rows that intersect that band (or bridge more aggressively), still excluding stems.
3. Keep rejecting truly ambiguous non-head ink; never invent pitch from harmony.

Ledger reconstruction (Phase 4) only if (1)+(2) are insufficient after focused tests.
