# Font-aware pitch anchoring campaign

## Scope and frozen baseline

- Base: `73f0ef6371dbea3e2672dc690aca4605c4eda78c`
- Evaluator: frozen 2.0.0 / schema 2
- Corpus: nine frozen fixtures, written-pitch mode
- Production systems left unchanged: tie ownership and written flags, duration cap/recovery, path accidentals, ghost-staff rejection, singleton-column evidence, adjacent-slot chord timing, and joint polyphonic rhythm packing.

| Metric | Baseline | Accepted | Delta |
|---|---:|---:|---:|
| Overall | 66.74% | 67.12% | +0.38 pp |
| Pitch | 66.22% | 66.86% | +0.64 pp |
| Rhythm | 74.52% | 74.64% | +0.12 pp |
| Measure structure | 71.69% | 72.85% | +1.16 pp |
| Sustain | 55.56% | 55.56% | unchanged |
| Articulation | 85.84% | 86.61% | +0.78 pp |

| Defect | Baseline | Accepted | Delta |
|---|---:|---:|---:|
| Incorrect pitch | 178 | 161 | -17 |
| Incorrect chord | 195 | 182 | -13 |
| Onset mismatch | 175 | 170 | -5 |
| Duration mismatch | 102 | 102 | unchanged |
| Missing note | 136 | 136 | unchanged |
| Extra note | 112 | 112 | unchanged |

The frozen comparison gate accepted the candidate with no fixture-level regression.

## Phase 1 inventory

The baseline inventory is in `PHASE_1_PITCH_ERROR_INVENTORY.md`; the complete machine-readable records are in `baseline/pitch_error_inventory.json`, with calibration samples in `baseline/pitch_anchor_samples.json`.

The detailed matcher recorded 167 pitch mismatches. The official evaluator recorded 178; that difference comes from the detailed matcher's stricter one-to-one alignment and does not alter official scoring. Overlapping baseline mechanisms were:

| Mechanism | Detailed mismatches | Evidence |
|---|---:|---|
| Wrong staff-step anchor | 126 | Generated pitch differed diatonically after glyph-to-staff projection. |
| Glyph-center offset candidate | 58 | PDF glyph metrics placed the anchor far enough from the expected staff lattice to change pitch. |
| Accidental/state symptom | 39 | Natural staff position was compatible but emitted alteration differed. |
| Octave displacement symptom | 25 | Pitch difference crossed an octave boundary; most also belonged to a staff-step cluster. |
| Ledger ownership | 10 | A nearby ledger fragment could affect or obscure the local center. |
| Unresolved/alignment symptom | 13 | No unique geometry-stage cause was demonstrable. |
| Raster/path without usable font geometry | 44 | No PDF text-glyph anchor was available for this campaign's rule. |

No remaining baseline mismatch had an exact expected-pitch match under the recorded alternate clef/staff mapping. That ruled out a broad clef or staff reassignment. The first reliable divergence for the accepted cluster was the conversion of the PDF text origin/full glyph metrics into a staff-position anchor.

## Font and glyph findings

PDF music fonts in the corpus expose noteheads as text glyphs whose reported origin and height are not the visual oval's center. The offset changes with glyph outline, font embedding, scaling, and transform. Using the full bounding-box center is unsafe because the box may include baseline padding or stem/extrema space.

Rendered local ink supplies a common coordinate system for canonical SMuFL text glyphs and equivalent vector output. Reliable heads had these properties after normalization by local staff spacing:

- a compact width and height consistent with a notehead;
- a plausible horizontal and vertical displacement from the PDF glyph origin;
- no long horizontal staff/ledger row through the candidate;
- no long vertical stem column inside the candidate;
- no competing head-sized component at a nearby vertical position.

The accepted rule uses local five-line spacing, never a page-wide average. It does not infer a pitch from scale, harmony, neighboring melody, or expected answers. If the component is missing, too large, too small, outside the general glyph-origin range, or vertically ambiguous, it retains the frozen metric anchor.

Legacy music-font codepoints are tagged when normalized to SMuFL. Because the frozen corpus does not provide enough independent calibration for a safe legacy profile, those glyphs explicitly retain the frozen metric anchor. This preserves existing legacy recognition while making provenance available for a future profile supported by evidence.

## Staff and ledger model

The accepted implementation:

1. converts the active local staff-line model to analysis-image pixels;
2. derives local spacing from those five lines;
3. scans a spacing-normalized window around the PDF glyph origin;
4. suppresses long horizontal staff/ledger rows and long vertical stem columns;
5. forms connected compact ink components, bridging only narrow gaps created by suppressed line rows;
6. accepts only one head-sized component within a conservative general glyph-origin range;
7. maps its independent vertical center through the existing clef-relative staff-position function.

Chord tones retain separate visual centers. Displaced seconds are therefore not snapped to a neighboring tone. Ledger fragments can support the visual component only where they intersect the same local window; a fragment cannot pull a neighboring note across the x-origin gate. Staff ownership and clef logic remain unchanged.

## Focused geometry fixtures

`tests/omrFontAwarePitchAnchor.test.js` contains 14 focused cases:

1. filled notehead between staff lines;
2. asymmetric open notehead;
3. stem-inclusive glyph bounds;
4. scaled/transformed glyph metrics;
5. one ledger line above the staff;
6. multiple ledger lines;
7. competing ledger fragment;
8. displaced chord seconds;
9. nearby accidental;
10. cross-staff geometry using the supplied local staff;
11. treble and bass clef mapping from identical geometry;
12. rejection of ambiguous vertical components;
13. equivalent text-glyph and vector-path staff position;
14. conservative fallback for an uncalibrated legacy-font profile.

Alto and tenor clefs are not supported by the current pitch mapper. No synthetic support was added without a production path and corpus evidence.

## Experiments

### Rejected: full glyph/bounding-box center

Historical and current probes confirmed that full-box centering includes font baseline padding and sometimes stem/extrema geometry. It caused large staff-step and octave errors and was not implemented.

### Rejected: broad rendered-ink center

A broad component rule improved some dense examples but damaged another font and a tuplet fixture. Corpus result: Overall 66.2%, Pitch 63.9%. Rejected.

### Rejected: permissive compact component

A less selective compact rule reached Overall 67.03% and Pitch 67.02%, but Rhythm fell to 74.44% and onset mismatches rose to 179 because ambiguous components perturbed chord/rhythm grouping. Rejected.

### Accepted: compact component plus font-origin gate

The final rule narrows component size, rejects vertical ambiguity, and requires a conservative glyph-origin displacement. It removes 17 official pitch mismatches and 13 chord mismatches while preserving note counts and improving Rhythm.

## Real-score validation

Fresh OMR was run against one page of a sustained two-staff score and two pages of a dense polyphonic score. Baseline results came from a detached worktree at the exact base commit.

### Sustained two-staff score

- Measures 25 → 25; notes 138 → 138; events 93 → 93; chords 25 → 25.
- Staff assignment unchanged: lower 101, upper 37.
- Broad staff-range outliers 0 → 0; ledger notes 78 → 78; explicit accidentals 5 → 5.
- Ties remained balanced at 5 starts / 5 stops.
- Playback duration remained 83.3333 seconds; acceptance and warnings were unchanged.
- The conservative rule rejected all 138 glyph anchors, so pitch-class and octave distributions were identical.

### Dense polyphonic score

- Measures 49 → 49; notes 802 → 802; events 713 → 714; chords 144 → 144.
- Staff assignment unchanged: upper 516, lower 286.
- Broad staff-range outliers 45 → 45; ledger notes 325 → 325; explicit accidentals 93 → 93.
- Tie balance remained zero; playback duration remained 105 seconds; acceptance and warnings were unchanged.
- Four of 802 glyph anchors met all geometry gates. Octave-bin counts changed only at adjacent boundaries (octave 2: 75 → 74, 3: 28 → 29, 4: 252 → 250, 5: 264 → 266); there was no staff reassignment or broad-range increase.

Visual inspection of the affected PDF regions confirmed that accepted components coincide with compact notehead ink after staff/ledger rows and stem columns are removed. Dense chord seconds and accidental clusters remain independently anchored. Diagnostic PDFs, crops, paths, and generated MusicXML remain under `tmp/` and are excluded from the commit.

## Validation

- Focused anchor/staff/font tests: 44 passed.
- Frozen semantic corpus: 9/9 fixtures; evaluator 2.0.0 / schema 2; accepted with no regression gate failures.
- Preservation suite (Guitar/TAB, ties, accidentals, playback/audio, reports, acceptance, performance): 197 passed.
- Full unit suite: 2,791 passed, 5 skipped across 277 files.
- Production build: passed (1,494 modules transformed).
- Targeted lint and diff whitespace checks: passed.

## Remaining bottlenecks

- Accidental-state mismatches remain substantial but are outside this campaign and were not retuned.
- Raster-only and fragmented path noteheads lack reliable PDF font-origin metadata; improving them requires a separate connected-component/outline ownership campaign.
- Some dense glyph windows contain overlapping heads, beams, or notation marks that remain correctly rejected as ambiguous. Resolving them safely requires explicit component ownership across chord members rather than a looser threshold.
- Ledger cases with multiple plausible owners require a joint ledger-to-note ownership graph. This campaign deliberately does not guess.
- No evidence supports a global clef, staff, or octave correction; those would be architectural changes with high regression risk.

The accepted change is confined to visual pitch anchoring and provenance. Evaluator logic, truth data, expected outputs, accidental recognition, voice/rhythm packing, duration inference, and frozen acceptance thresholds are unchanged.
