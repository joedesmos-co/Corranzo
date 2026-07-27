# Phase 3 — Visible Rests and Voice Gaps: NO PRODUCTION CHANGE

Date: 2026-07-27
Decision: **No production change shipped.** Remaining missing-rest flags are
dominated by measure misalignment, multi-voice staff occupancy, and
glyph-absent empty staves. No safe glyph-evidence recovery met the acceptance
bar without inventing rests or shifting notes.

## Rest defect inventory (Phase 1 candidate, written mode)

Raw evaluator counts are heavily inflated by unmatched measures:

| Source | missing-rest (aligned / unmatched) |
| --- | --- |
| la-campanella | 0 / 289 |
| hungarian-dance-no5 | 5 / 85 |
| fantaisie-impromptu | 2 / 50 |
| carol-of-the-bells | 38 / 4 |
| gymnopedie | 17 / 21 |
| moonlight-3 | 0 / 34 |
| minecraft | 0 / 26 |
| evangelion | 1 / 18 |
| piano-rhythm-tuplets-vector | 3 / 0 |

Aligned-only rest problems (~66 missing-rest) are the real Phase 3 target.

## Glyph evidence in PDF text layers

| Source | Supported SMuFL rests | Pipeline applied / skipped |
| --- | --- | --- |
| gymnopedie | 31 | 6 applied / 25 overlaps-staff-notes |
| la-campanella | 102 | 69 applied / 33 skipped (31 overlaps, 2 dup) |
| fantaisie-impromptu | 21 | 13 applied / 6 overlaps |
| evangelion | 10 | 2 applied / 8 overlaps |
| piano-rhythm-tuplets-vector | 5 | (baseline already applies most) |
| minecraft | 3 | 3 applied / 0 skipped |
| carol / moonlight / hungarian / dense / articulation / grand-voices | 0 | n/a |

## Root-cause classes

### 1. Measure misalignment (majority of raw ~593 missing-rest)

La Campanella 289, Fantaisie 50, Hungarian 85, etc. are almost entirely on
unmatched measures. Not rest-detection defects.

### 2. Glyph rest skipped: overlaps-staff-notes (Gymnopédie / Evangelion / Campanella)

Gymnopédie: all 25 skips are bass quarter rests at `positionInMeasure ≈ 0.1`
while bass note events already occupy from division 0 (no staff gap). Example
m1: notes at `@0+12` and `@4+8`, bass rest preferredStart≈1 lands inside the
opening occupancy. Inserting the rest would require shifting notes — forbidden
by Phase 3 (“do not stretch notes to fill gaps”).

Evangelion: 8 skips, 0 with a staff gap (same class).

La Campanella: 31 overlaps. Of those, only 3 have a gap within 2 divisions of
the glyph column; inspecting them shows the preferred column still sits inside
a note span (multi-voice bass), and nearest-gap placement would put at least
one rest (m11 preferred=8 → gap [4,6]) in the wrong place. Rejected.

### 3. Glyph-absent empty staves (Carol)

Carol has **zero** SMuFL rest glyphs in the PDF text layer. Aligned missing
rests are mostly bass whole-measure / dotted-half rests and treble eighth gaps.
Empty-staff audit found 6 fix-candidates (generated staff empty, truth staff
rest-only) and 0 under-detection risks — but emitting whole-measure rests
without glyph evidence violates the Phase 3 glyph-evidence rule and would
reintroduce the previously rejected phantom empty-measure rests.

### 4. Multi-voice voice-rest encoding (Gymnopédie aligned 17/17)

All 17 aligned Gymnopédie missing-rest flags are in truth-multi-voice
measures. Staff-level rest insertion cannot see voice-level gaps when another
voice fills the timeline. Voice separation is architectural backlog (same
conclusion as Phase 2).

## Attempted methods (analysis only — not shipped)

1. Re-taxonomize missing-rest by alignment → most raw count is misalignment.
2. Empty-staff whole-rest synthesis without glyphs → rejected (no glyph evidence).
3. Nearest-gap recovery when preferredStart overlaps notes → Gymnopédie/Evangelion
   have no gaps; Campanella near-gaps are multi-voice and unsafe.
4. Widening/removing the overlaps-staff-notes guard → would invent rests inside
   note columns.

## Verdict

Leave production rest logic unchanged. The vector glyph detector already applies
rests safely when a clear same-staff gap exists (Minecraft 3/3; Campanella 69/102;
Gymnopédie treble wholes). Residual defects need either:

- correct note onset grids so opening rests have a gap (rhythm phase), or
- per-voice rest attachment (architecture), or
- non-text visual rest evidence for glyph-absent editions (Carol) — out of
  current SMuFL-text detector scope.

## Artifacts

- `tmp/omr-quality-campaign/phase3-rest-glyph-probe.mjs`
- `tmp/omr-quality-campaign/phase3-rest-diagnostics.mjs`
- `tmp/omr-quality-campaign/phase3-missing-rest-details.mjs`
- `tmp/omr-quality-campaign/phase3-empty-staff-audit.mjs`
- `tmp/omr-quality-campaign/phase3-skip-detail.mjs`

## Backlog

1. Opening-bass onset grid that leaves room for printed leading rests (Gymnopédie).
2. Per-voice rest attachment for multi-voice staves.
3. Path/ink rest detection for editions without SMuFL rest text (Carol).
4. Do not chase unmatched-measure missing-rest counts.
