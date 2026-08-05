# Scan False Accent Inventory

**HEAD:** `83c48f3`  
**Fixture:** `piano-articulation-scan`  
**Generated:** 2026-08-05  
**Crops:** `tmp/omr-zero-defect/false-accent-inv/crops/`  
**Emitter:** `assignNoteAnchoredRasterArticulations` → `classifyBlob` (`detectNoteAnchoredRasterArticulations.js`)

## Counts

| Set | Count |
| --- | ---: |
| Truth accents | 12 (treble beat-1 chords on m2/m4/m6/m8) |
| Generated accents | 16 |
| True positives | 12 |
| Unexpected (false) accents | **4** |

## False positives (all source-unsupported)

| # | Measure | Onset (in-measure quarters) | Owner | Staff/Voice | Stem | Placement | Pipeline (cx,cy) | PDF visual | Class |
| --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2 | 1.0 | E4 (single) | 1 / 1 | up | above | 378, 300 | Slur arc ink above/through staff near mid-measure attack | **4. slur/tie fragment** |
| 2 | 3 | 2.0 | B4 (chord) | 1 / 1 | — | above | 608, 273 | Slur / curve fragment over mid-measure chord | **4. slur/tie fragment** |
| 3 | 3 | 2.0 | G♯4 (chord mate of #2) | 1 / 1 | — | above | 612, 283 | Same mark broadcast to chord | **4 + ownership broadcast** |
| 4 | 3 | 3.0 | A4 (single) | 1 / 1 | up | **below** | 648, 277 | Descending slur arc under staff | **4. slur/tie fragment** |

Notes:

- #2 and #3 are **one column / one mark** broadcast to chord mates (existing MusicXML chord semantics) — counts as two unexpected accent tags, one visual false mark.
- No beam/stem/staff-only fragments are the primary mark; staff lines are masked but **slur arcs survive** as hollow wide components.
- Visually **no printed accent** at these onsets in the PDF (accents only on even-measure beat-1 chords).

## Production path

1. `processOmrPage.js` → `assignNoteAnchoredRasterArticulations(imageData, noteheads, measureBox, inkThreshold)`
2. Column group by clef + `OMR_CHORD_MERGE_X`
3. Above/below patches in staff-spaces; dense staff rows masked (wide probe); short islands on staff kept
4. `classifyBlob`: accent if size/aspect/fill/asymmetry gates pass (hollow chevron tolerant)
5. Best score wins; accent bias −28; broadcast to chord mates

**Failure rule:** hollow-chevron accent gates accept **clipped slur-arc segments** that are wider than a true wedge and often touch the horizontal crop boundary.

## True accent controls (recognized correctly)

| Measure | Owners (beat-1 treble) | Placement | Visual |
| --- | --- | --- | --- |
| 2 | A4 / F♯4 / D4 | above | Compact hollow `>` above chord |
| 4 | C5 / A4 / F4 | above | Compact wedge; fingering “4” nearby but not selected |
| 6 | E5 / C♯5 / A4 | above | Compact wedge |
| 8 | G♯4 / B4 / E4 | above | Compact wedge |

Control geometry (vs FPs):

| Feature | True accents | False (slur) accents |
| --- | --- | --- |
| Shape | Short wedge/chevron, ~0.5–1.3 staff spaces wide | Longer arc segment spanning much of the patch |
| Isolation | Contained inside crop; not touching L/R edges | Often touches left/right crop edge (curve continues) |
| Vertical | Localized near chord extreme | Can sit below (m3 A4) on slur under staff |
| Center | Near column cx | May be off-center along the arc |
| Stroke | Two oblique arms / tip | Single curved band |

## Shared failing rule (Phase 1 conclusion)

**Slur/tie curve fragments surviving note-anchored patch classification as accents**, because:

- fill/aspect gates intentionally allow hollow outlines
- patch clipping turns a long slur into a “wedge-sized” CC
- no test for **horizontal isolation** (touching patch L/R edge) or **max compact width**

Not benchmark inconsistency — marks are not printed accents.

## Fix hypothesis (Phase 3)

Narrowest general rule:

1. Reject accent candidates whose blob touches the left or right bound of the articulation crop (slur continuation).
2. Cap accent width more tightly relative to staff space (compact wedge only).
3. Prefer stronger left/right asymmetry or contained hollow chevron; abstain on long single-band arcs.

Must not remove beat-1 true accents or change staccato/tenuto.

## Phase 2 — true accent controls

All 12 beat-1 treble chord accents (m2/m4/m6/m8) remain recognized. Control geometry vs FPs:

| Feature | True | False (slur) |
| --- | --- | --- |
| Size | ~6×5–7×5, height/width ≥ 0.55 | Often flatter or edge-clipped |
| Isolation | Inside crop; no L/R edge touch | Edge-touching arc bands (FP1, FP4) |
| Asymmetry | sideBalance ≥ ~0.13 or near-square hollow | Flat crumbs with low asymmetry (FP2/3) |
| dx | ≤ ~0.32 staff spaces | Can drift along the arc |

## Phase 3 — accepted fix

**Shared failing rule:** hollow-chevron accent gates accepted clipped slur-arc segments and near-head slur crumbs; rejecting accents then left a staccato-sized crumb on m2 E4.

**Narrow rules (no fixture hardcoding):**

1. Reject crop-edge-touching blobs as any articulation.
2. Require accent height/width ≥ 0.55, min height ≈ 0.36 staff spaces, dx ≤ 0.32 staff spaces, and left/right asymmetry (or compact near-square hollow).
3. Raise staccato fill floor to 0.72 (hollow slur crumbs fail).
4. Abstain when ≥2 staccato candidates compete in one column.
5. Reject staccato candidates with dy < 2.05 staff spaces (slur-junction crumbs hug the head; engraved dots sit farther).

**Result at accept:** gen accents 12/12, staccato 12/12, unexpected accent FP 0, unexpected staccato FP 0, scan Articulation **100%**, notes 88/88, Pitch/Measure Structure 100%.
