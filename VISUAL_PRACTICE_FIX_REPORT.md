# ScoreFlow Visual Practice Fix Report

**Date:** 2026-06-13
**Commits:** visual-practice fix `b162fac`/`a5b5a51`; UX polish `989765a`
**Branch:** main

---

## What was broken

The smoke tests from the previous pass (`BROWSER_SMOKE_REPORT.md`) validated that controls
exist and the clock advances — not that the cursor appears at the correct position on the
score. In real browser testing the practice screen was visually broken:

| Symptom | Root cause |
|---|---|
| Cursor at measure 31 appears on the **wrong system** of the score | Bundled anchors assumed 4 systems with y=[0.31, 0.45, 0.59, 0.73]; actual PDF has **6 systems** |
| Cursor ~9 % of page height too high at every late-measure position | Same wrong y-positions throughout |
| Cursor x positions wrong (8 measures/system, evenly spaced) | Real system widths and measure counts are not uniform |
| Floating toolbar overlaps the top of the score (system 0 partially hidden) | `viewer-float-toolbar` is `position:absolute; top:10px` inside the stage; PDF body had no top clearance |
| Page-follow scroll used frame height but cursor.y is normalised to page height | `usePracticePageFollow` queried `.pdf-page-frame`; should prefer `.react-pdf__Page` |

---

## Investigations

### PDF structure (PyMuPDF analysis)

Opened `public/fixtures/demo-minuet-in-g.pdf` with PyMuPDF to extract staff-line and
bar-line coordinates directly from the PDF drawing commands.

**Page:** 595.3 × 841.9 pt (A4 portrait, 1 page)

**Staff systems found (grand-staff midpoints):**

| Sys | Treble y-range | Bass y-range | Grand-staff midpoint | normalised y |
|-----|---------------|--------------|---------------------|-------------|
| 0   | 103.2–124.1   | 150.5–171.5  | 137.3 pt            | **0.1631**  |
| 1   | 213.3–234.2   | 260.4–281.3  | 247.3 pt            | **0.2937**  |
| 2   | 323.1–344.1   | 370.2–391.1  | 357.1 pt            | **0.4242**  |
| 3   | 433.0–453.9   | 480.1–501.0  | 467.0 pt            | **0.5547**  |
| 4   | 542.8–563.7   | 598.4–619.4  | 581.1 pt            | **0.6902**  |
| 5   | 661.2–682.1   | 708.5–729.4  | 695.3 pt            | **0.8259**  |

**Measures per system** (extracted from bar-line x positions):

| Sys | Measures    | Count | Notes |
|-----|-------------|-------|-------|
| 0   | M1 – M5     | 5     | Section A opening |
| 1   | M6 – M10    | 5     | |
| 2   | M11 – M16   | 6     | Double bar at end = section A repeat |
| 3   | M17 – M21   | 5     | Begin-repeat bar at x=63.9/67.4 before M17 |
| 4   | M22 – M26   | 5     | |
| 5   | M27 – M32   | 6     | Double bar at end = final bar |

Total: **32 written measures** — matching the MusicXML.

**Old anchors (wrong):** 4 systems × 8 measures, y=[0.31, 0.45, 0.59, 0.73] — guessed not measured.
**Measure 31 old position:** x=0.685, y=0.733, systemIndex=3
**Measure 31 new position:** x=0.673, y=0.826, systemIndex=5

The old y was 0.093 of page height (≈78 pt on an 842 pt page) too high — cursor appeared
in the middle of system 3 instead of system 5.

---

## Changes made

### 1. `public/fixtures/demo-minuet-in-g.anchors.json` — regenerated

Complete replacement with 32 PDF-extracted anchor positions. Key differences:
- 6 real systems instead of 4 estimated
- y-positions from actual staff-line midpoints, not guesses
- x-positions from actual bar-line x-coordinates, not evenly spaced within fake systems
- `calibrated: "pymupdf-barline"` in meta to document provenance

### 2. `scripts/generate-demo-anchors.mjs` — corrected

The generation script had `MUTOPIA_MINUET_SYSTEMS` hardcoded as a 4-system layout. Replaced
with the correct 6-system layout and moved from timing-weighted x estimation to direct
PDF-measured positions. Future runs of `npm run fixtures:anchors` now reproduce the correct file.

### 3. `src/App.css` — toolbar clearance in practice mode

Added:
```css
/* In practice mode the floating toolbar (position:absolute; top:10px; ~40px tall)
   sits above the PDF body. Reserve space so the first system is never hidden. */
.pdf-viewer-section--practice .pdf-viewer-stage {
  padding-top: 52px;
}
```

The toolbar bar (`~32px buttons + 8px padding`) sits at `top:10px` within `pdf-viewer-stage`.
The 52 px padding-top shifts the PDF body below the toolbar so system 0 (y≈0.163 ≈ 16%
from page top) is never obscured.

### 4. `src/features/practice/usePracticePageFollow.js` — correct reference element

The scroll target calculation used `.pdf-page-frame` as the reference rect. The cursor.y
coordinate is normalised to the `react-pdf__Page` dimensions (which the overlay stack
explicitly measures). When the frame has any extra height the scroll target is slightly
off. Changed to prefer `.react-pdf__Page` with `.pdf-page-frame` as fallback.

### 5. `tests/visualPractice.test.js` — new regression tests (15 tests)

| Test group | What it guards |
|---|---|
| Demo anchor structure | 32 anchors, 6 systems 0–5, correct y-midpoints (±0.01), all coordinates in [0,1] |
| M31 specifically | y > 0.80 (system 5), not the old 0.733 (system 3) |
| Cursor resolver with real data | At 94 % and 96 % of piece → visible cursor at measureNumber 31 |
| Cursor bounds sweep | cursor.x/y ∈ [0,1] and cursor.page=1 for all sample times |
| Measure coherence sweep | cursor.measureNumber === getMeasureAtTime(t).number at every 1s sample |
| Page-follow scroll math | Fit-page: no scroll; fit-width with M31: cursor stays in visible area |

---

## Test results

```
Test Files  12 passed (12)
     Tests  91 passed (91)   ← +12 in tests/uxFixes.test.js (UX polish pass)
                              ← +15 in tests/visualPractice.test.js (anchor fix)
                              ← 64 before this work began
```

`npm run build`: green (same pre-existing chunk-size/dynamic-import warnings, no new errors)
`npm run lint`: 71 problems (unchanged baseline, all pre-existing `no-unused-vars`/react-hooks)
`no-undef` pinned at 0 by staticIntegrity test.

---

## Before / After comparison

| Location | Before | After |
|---|---|---|
| Measure 31 cursor y | 0.733 (system 3, ~73% from top) | 0.826 (system 5, ~83% from top) |
| Measure 16 cursor y | 0.453 (system 1, wrong) | 0.424 (system 2, correct) |
| Measure 1 cursor y | 0.310 (guessed) | 0.163 (real: below title/header) |
| System count | 4 (wrong) | 6 (real) |
| Toolbar vs score | Toolbar overlaps system 0 content | 52 px clearance keeps system 0 visible |
| Page-follow ref element | `.pdf-page-frame` | `.react-pdf__Page` (more precise) |
| Anchor source label | `calibrated: "mutopia-a4"` | `calibrated: "pymupdf-barline"` |

---

## What still needs manual verification on device

The following items require a real browser (Safari on Mac/iPad):

1. **Cursor spans full grand staff**: play the demo, confirm the purple bar covers both
   treble and bass staves at every system (should be ~9 % of page height, not a tiny mark).
2. **Cursor glides within measures**: watch x advance smoothly across each measure;
   no more hard jump at each measure boundary.
3. **Seek snaps**: drag the seek slider to 40 %, 75 %, 96 %; cursor should appear
   instantly at the new position, not slide from the old one.
4. **Synth tone**: play the demo in Safari; notes should sound like a soft piano, not
   harsh beeps. Metronome should be quieter and less clicky.
5. **Annotation pointer mode**: open the PDF viewer, confirm ↖ pointer button is present
   and active by default. Tap ✎ Pen, draw a stroke, then tap ↖ again — drawing must
   stop and normal scroll/tap interaction must resume.
6. **Toolbar clearance**: system 0 treble (y ≈ 0.163) must be fully visible below the bar.
7. **iPad Safari**: same checks on the physical device.
