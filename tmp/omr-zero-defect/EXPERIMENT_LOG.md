# Corranzo zero-defect OMR experiment log

## Program initialization - 2026-08-03

- Starting HEAD: `2366c3727d1c0794a57a2b1ef4ff185a7ce7ab29`
- Tracked production and test files: clean.
- Permitted untracked research present: `tmp/mic-extreme-register/`.
- The latest commit is the completed extreme-register microphone campaign. Its report records the frozen OMR baseline as 9/9 fixtures, evaluator 2.0.0/schema 2, Overall 71.094%, Pitch 75.740%, Rhythm 81.226%, Articulation 90.598%, Measure Structure 81.201%, Sustain 55.556%, 650 total defects, 110 incorrect pitches, 122 incorrect chords, and 81 onset mismatches.
- No production or test files were changed during initialization.

## Active work

### Frozen baseline and live ledger

- Reproduced the frozen corpus at the starting HEAD: 9/9 fixtures, evaluator 2.0.0/schema 2, with exact equality to the accepted OMR baseline.
- Metrics: Overall 71.094%, Pitch 75.740%, Rhythm 81.226%, Sustain 55.556%, Articulation 90.598%, Measure Structure 81.201%, Interpretation 13.333%.
- Official defect count: 650. The live `DEFECT_LEDGER.json` contains exactly all 650 evaluator entries with detector/MusicXML provenance where available.
- Incorrect chord: 122 official evaluator entries; 95 unique structural chord events in the independent detailed inventory. This distinction is retained rather than treating split/merged-measure alignment symptoms as independent chord recognizer failures.
- Source audit carried forward and reattached note-by-note: 12 dense high-extreme chord expectations require unprinted natural cancellations. They account for 12 incorrect-chord and 12 incorrect-pitch entries (24 total) and remain classified as benchmark truth defects, not production gains.
- Highest-volume source-supported target: the scanned Piano articulation fixture (227 defects), followed by paired Guitar ownership/measure alignment (102) and TAB-only rhythm (72).

### Active experiment

Trace the scanned Piano fixture from raster components through notehead/chord/articulation instances and test a materially different joint symbol-instance architecture.

### Scanned symbol-instance milestone - 2026-08-04

- Canonicalized thick raster staff bands and rejected shorter volta/ledger rows from the five-line staff model.
- Enabled strongly supported quarter-degree deskew corrections; this source carries a measured -0.25 degree correction with 0.5967 staff-line evidence improvement.
- Added compact-shape fragment rejection and same-blob raster candidate deduplication.
- Replaced a temporary 0.22-staff-space pitch probe with page-local staff-lattice phase calibration. The scan independently inferred 0.211683 staff spaces from 71 candidates (35 in the dominant cluster; confidence 0.7215).
- Added two-sided, scale-aware stem probes and removed the invalid filled-head/long-stem => half-note inference. This experiment was metric-flat in isolation because the legacy shared staff cursor still discarded simultaneous bass events.
- Added independent treble/bass raster rhythm lanes. Relative to the starting scan fixture this improved Overall 42.7% -> 49.5%, Pitch 26.8% -> 41.3%, Sustain 0% -> 20%, Measure Structure 47.1% -> 55.2%, and reduced defects 227 -> 174. Rhythm moved 69.6% -> 67.4% and Articulation 15.4% -> 22.5%; this remains active pending onset repair and full-corpus validation.

### Rejected: hard optical-body polarity gate - 2026-08-04

- Hypothesis: false raster anchors between vertically stacked heads could be rejected when compact ink lay predominantly below the anchor.
- Result: detector candidates fell 95 -> 70, but missing notes rose 19 -> 36. Overall fell 49.5% -> 45.9%, Pitch 41.3% -> 39.6%, Rhythm 67.4% -> 64.4%, Sustain 20% -> 0%, and Measure Structure 55.2% -> 50.0%.
- Cause: legitimate scanned glyph anchors do not share a sufficiently stable one-sided body polarity before symbol ownership is resolved.
- Decision: fully reverted the production gate and its test. Retain the diagnostic lesson; any revisit must use joint instance selection, not hard candidate filtering.

## Resume audit and milestone recovery - 2026-08-04 (Cursor continuation)

- Verified HEAD `45239caf875ab4c0f94ca81d89c03d3cf3e8de59` (ahead of baseline by three already-committed OMR commits).
- Tracked working tree clean; only untracked research under `tmp/`.
- Stale PROGRAM_STATE still pointed at `2366c37` with empty accepted commits; repository evidence supersedes that checkpoint.
- No rejected production residue present; no resets performed.

### Independent revalidation of interrupted milestone

- Focused milestone tests: 82/82 pass.
- OMR regression: 717/717 pass.
- Full unit suite: 2938 pass / 5 skipped.
- Production build: pass.
- Guitar/TAB/mic/playback/ownership/report protections: 735/735 pass.
- `npm run test:scripts`: pass.
- Heavy-score performance harness: PASS.
- Frozen corpus 9/9 at HEAD: Overall 73.511%, Pitch 85.777%, Rhythm 81.336%, Sustain 55.556%, Articulation 90.793%, Measure Structure 87.774%, Interpretation 13.333%.
- Defects 650 → 518; incorrect-chord 122 → 81; incorrect-pitch 110 → 51.
- Scan fixture: 88/88 notes, Pitch 100%, Measure Structure 100%, 0 missing/extra/onset/incorrect-chord; 32 duration-mismatch remain.
- Visual audit of scan crops + MusicXML: expected staff-2 has exactly 32 `half` notes; PDF shows filled stemmed heads. Classified as benchmark-truth defects. Source-faithful OMR correctly emits quarters.

### Commit family already present (no recommit)

1. `026f81e` raster notehead instance recovery / geometry / calibration
2. `d9d2a23` raster accidental ownership
3. `45239ca` independent raster staff lanes + source-faithful filled-head rhythm

`d9d2a23` had slightly higher original-corpus Overall (73.8%) because some bass durations still matched MusicXML halves; `45239ca` intentionally prefers source PDF correctness.

### Live ledger regenerated

- Inventory: `tmp/omr-zero-defect/head-ledger/` (363 structured mismatches; 54 unique structural incorrect-chord events).
- Official ledger: `DEFECT_LEDGER.json` now 518 official evaluator defects; 56 benchmark-truth; 462 unresolved.
- Next experiment: paired Guitar incorrect-chord / notation-TAB ownership (`guitar-paired-chords-vector`, 71 mismatches, 16 structural incorrect chords).

## Accepted: snap late barlines to note-column gaps - 2026-08-04

- Hypothesis: paired-guitar incorrect chords were mostly late barlines placing each measure's opening chord column into the previous measure.
- Evidence: system-0 note X columns showed regular ~0.027 gaps then a ~0.075 gap before a trailing column sitting 0.007 left of the detected barline; TAB pairing was already 116/116.
- Implementation: `clusterVectorNoteheadColumns` + `snapMeasureSpansToNoteColumnGaps` in `buildOmrMeasureGrid.js`, always fed column centroids from `processOmrPage.js` (including TAB chordal systems where stem rejection stays disabled).
- Result: corpus ACCEPT. Overall 73.511%→74.102%, Pitch 85.777%→87.269%, Rhythm 81.336%→82.048%, Measure Structure 87.774%→89.709%. Defects 518→473; incorrect-chord 81→70. Paired guitar Overall 72.2%→77.5%, Pitch 58.5%→71.9%, Rhythm 91.7%→98.1%, Measure Structure 55%→72%, fixture defects 104→59. Scan Pitch/Measure Structure remain 100%.
- Commit: `7557401`.
- Remaining on paired guitar: system-2 still emits 6 measures (truth 4) → split-measure cascades; residual incorrect pitches on m2–m3 after ownership repair.

## Accepted: rebuild unreliable grids from note-column gaps - 2026-08-04

- Follow-on to `7557401`. System 0 was repaired by late-boundary snap, but system 2 remained density-thinned into 6 false measures (truth 4) with split-measure cascades.
- Evidence: 16 clustered note columns with three large inter-pack gaps (~0.075–0.092) versus median intra-pack gaps (~0.027).
- Implementation: `rebuildSpansFromNoteColumnGaps` runs only when barline reliability is low and large column gaps imply fewer measures; then the late-boundary snap still applies.
- Result vs raster milestone `45239ca`: Overall 73.511%→74.642%, Pitch 85.777%→89.244%, Measure Structure 87.774%→91.584%, defects 518→441, incorrect-chord 81→62. Paired guitar: 10→8 measures, Overall 72.2%→82.3%, Pitch 58.5%→89.7%, fixture defects 104→27. Scan unchanged.
- Commit: `c52a38a`.

## Rejected / deferred: TAB digit near-boundary measure reassignment - 2026-08-04

- After measure-gap rebuild, paired guitar TAB pairing fell 116→94 attached with 22 unpaired notation notes. Residual m2/m3 pitches look like staff pitches without TAB overwrite.
- Hypothesis: snapped barlines split notation noteheads and TAB digits across measures.
- Attempt: assign near-boundary TAB digits using nearest notation column anchors in `findMeasureBoxForX`.
- Result: no fixture metric change (still Overall 82.3% / Pitch 89.7% / 94 attached). Unit geometry for the hypothesized 0.305-vs-0.346 split preferred the previous measure's last column. Fully reverted.
- Next revisit must inventory actual unpaired digit X vs notation column X before changing assignment.

## 2026-08-04 — TAB measure-number digit rejection (ACCEPTED `934f011`)

Root cause: engraved bar numbers (1..8) on guitar-tab-sparse were extracted as fret digits on string 1 (ghost frets matching measure numbers), inflating groupCount to 5 and forcing slotCount=16 sixteenth packing.

Fix:
- Reject glyphs above TAB staff band
- Reject leftmost measure-number-equal digits on string 1 when other frets exist
- Pack non-compressed TAB with slotCount=groups.length when denser than beats

Anti-overfitting: unit tests for above-staff + leftmost measure-number; guitar corpus fixtures unchanged except tab-sparse gains.

## 2026-08-04 — Chord ink accidental dedupe + beat-1 path sharps (ACCEPTED `7495255`)

Root causes:
1. Ink accidental scan emitted one sharp glyph per chord tone sharing a blob → greedy assignLocalAccidentals attached sharps to E/A as well as F (m6 bleed).
2. Path accidentals with x < playableStart rejected as key-signature-region even when a notehead owned them (m1 F#).

Fix: dedupe ink glyphs by proximity keeping vertically nearest note; keep left-of-playable path accidentals that match a note.

## 2026-08-04 — TAB multi-voice residual cluster sharing (ACCEPTED)

Root cause: pairNotationTabInMeasure set bestCluster.used=true after first same-onset voice paired, leaving 22 unpaired notation notes on m2/m3/m7.

Fix: keep unmatchedTab on cluster; mark used only when empty; pair larger voices first.

## 2026-08-04 — ledger ink band widen for m7/m8 (REJECTED)

Widened vertical ink search for below-staff notes and relaxed note.cx vs playableStart gate. No metric movement on guitar-standard (still m7 C# / m8 F#/C#/F# missing). Fully reverted.

Residual: path candidates for those sharps are absent or not classified; needs path extraction / stacked-sharp ownership work, not band padding alone.

## 2026-08-04 — Dense piano pitch classification (no production change)

At HEAD 3ff28ab, piano-dense-advanced-vector: 27 incorrect-pitch, 24 incorrect-chord.
- 22/27 incorrect-pitch are same letter-class with expected natural vs generated sharp (accidental_state).
- Matches prior "hidden natural" benchmark finding: MusicXML expects cancelling naturals not printed on the PDF; OMR measure-state retention of sharps is source-faithful.
- 4× E5→F5 remain as possible production staff-step defects.
- Do not "fix" production to emit hidden naturals. Separate source-faithful scoring from original corpus.

## 2026-08-04 — Same-onset voice merge after TAB pairing (ACCEPTED)

After residual TAB sharing, 1+3 voice splits remained separate events; duration packing stretched singleton bass to half. mergeSameOnsetNotationEvents coalesces them with min duration.

## 2026-08-04 — stacked ledger path accidentals (ACCEPTED `b3414aa`)

Expanded measure Y pad for path accidentals from staff-gap×8 so deep ledger sharp stacks survive. guitar-standard Pitch 95→98; incorrect-pitch corpus 33→29.

## 2026-08-04 — mixed-stem joint voice split guard (ACCEPTED `9b97141`)

Do not peel same-column mixed stems unless one direction is a sustained half/whole with different written duration. guitar-standard P/R/M 100%.

## 2026-08-04 — uniform eighth/sixteenth packing (ACCEPTED `c017923`)

Median-gap chord-merge cap, uniform ×2/×4 grid snap, aligned-start durations, eighth-run subdivision protection. Tuplets Rhythm 59→89; corpus Rhythm 91.6→95.2; Overall 77.4→78.0.

## 2026-08-04 — raster articulation morphology (REJECTED)

Replaced 5×5 ink-count staccato with blob morphology + accent wedge detector. First pass emitted 83 false accents (staff-line fragments). Tightened thresholds still below baseline Articulation 17% (got 11–13%) with missing true staccatos. Fully reverted `detectOmrExpression.js` / `processOmrPage.js`. Needs joint instance selection with page-calibrated mark geometry, not isolated blob heuristics.

## 2026-08-04 — MuseScore open-cubic stroke ties (ACCEPTED `e6e9454`)

MuseScore exports ties as stroked open Bézier segments. Extraction previously required filled closed lenses → zero curves. Added open-cubic stroke extraction and cross-bar/cross-system pairing. Corpus Overall 78.9→83.7, Sustain 55.6→88.9. Raster scan ties remain unfixed (separate ink-arc path needed; structural pairing regresses incorrect-tie).

## 2026-08-04 — tempo Interpretation (REJECTED / not a production defect)

All 9 vector fixture PDFs lack printed metronome marks; truth MusicXML declares ♩=88. Emitting tempo without PDF evidence would violate source-faithful policy. Parser already works when marks are printed. Classification: **benchmark / corpus PDF exposure**, not OMR defect.

## 2026-08-04 — resume at 15422cd (continuation)

- Verified HEAD `15422cd`, clean production tree; regenerated corpus ledger (Overall 86.2%, Pitch 98.9%, Rhythm 97.2%, incorrect-chord 26 = dense hidden naturals only).
- Protected Guitar paired/standard P/R/M 100% confirmed.

### REJECTED: joint raster articulation instances

- Replaced per-note `detectStaccatoOnNote` with column blob detector + staff masking + accent classification.
- PDF evidence: staccatos sit in-staff above chords; accents are wide wedges; estimated staff Y ± corridor erased dots and fragmented accents.
- Multiple revisions (tight corridor, density-aware mask, accent score bias) still dropped scan Articulation 17%→8–10% with wrong ownership.
- Fully reverted `processOmrPage.js`; deleted uncommitted detector/tests.

### ACCEPTED `c2d374d` — drop unpaired raster orphan tie starts

- Evidence: truth “tie” m3 A4→m4 A♯4 is different-pitch (PDF slur); orphan-start keep stamped unpaired `tieStart` on m1/m5/m7 → incorrect-tie ×3.
- Removed orphan-start keep. incorrect-tie 3→0. missing-tie ×2 retained as benchmark encoding (slur mislabeled as tie).

### ACCEPTED `33ee7f3` — short vector rests left of packed attacks

- Tuplets m4 16th rest ~9px left of B4 was near-notehead filtered; preferred onset fell inside preceding A4 after deferJointPacking.
- Keep left-of-head rests; snap preferredStart past left noteheads; unpack same-onset columns when inserting short rests.
- Tuplets Rhythm 93%→96%, Overall 84.7%→85.1%; missing-rest 3→1; onset-mismatch 4→2. Guitar protected. Corpus Rhythm 97.2%→97.5%.


## 2026-08-05 — deferred validation + note-anchored articulations + tuplets m8

### Checkpoint validation (resume 33ee7f3 → fixed 5252f36)
- HEAD verified; Wet Hands F1 regression from short-rest unpack fixed in `5252f36`.
- Frozen corpus 9/9 at baseline metrics Overall 86.2% / A 90.7%.
- Pre-existing failures unchanged: `omrVectorRhythm` (4), `notationFidelitySprint3` (1).

### Phase A inventory
- Wrote `SCAN_ARTICULATION_INVENTORY.md`: 12 staccato + 12 accent on treble beat-1; legacy accents→staccato; many FPs.

### Phase B note-anchored articulations — ACCEPTED `f0c0c37`
- Architecture: chord-column staff-space crops; wide staff dense-row probe; keep short islands on staff lines; classify hollow chevron accents vs compact staccatos; one mark per column.
- Rejected prior joint morphology not repeated.
- Scan A 16%→86%; corpus A 90.7%→98.4%; Guitar P/R/M 100%; 88/88 notes.

### Tuplets m8 — ACCEPTED `83c48f3` (partial residual)
- Root cause: `refineDottedSubdivisionBaseDurations` gated on `!denseMeasure` while m8 has groups>beats.
- Fix: always run refine/align/overlap; sync note durations on refine; pack close followers by cx.
- Cleared missing-rest, dotted-rhythm-error, onset-mismatch on m8.
- Residual: C5 emitted quarter (enrich) vs eighth; terminal rest eighth vs quarter (glyph classifies as eighth — do not invent quarter without glyph evidence).


## 2026-08-05 — tuplets m8 residual reclassified (post [Trace](16dfe483))

PDF text-layer evidence for m8 (`x≈450–516`, `y≈360–376`):

- 5× `U+E0A4` noteheads
- 1× `U+E4E6` **eighth** rest at (516.4, 372)
- **0** SMuFL flag glyphs on the entire page
- **No** `U+E4E5` quarter rest on the page

Therefore the remaining original-corpus defects after `83c48f3`:

- `rest-duration-error` (eighth vs expected quarter)
- `duration-mismatch` C5 (quarter vs expected eighth)

are **benchmark-truth**, not source-supported production defects. Do not change recognition to imitate MusicXML.

Source-supported m8 cluster: **cleared** (dotted eighth recovered; terminal rest inserted; onsets aligned).

Next ranked source-supported work: scan unexpected-accent ×4.

## Accepted: reject unsupported raster accent fragments - 2026-08-05

- Target: 4 unexpected accents on `piano-articulation-scan` (m2 E4; m3 B4+G♯4 chord broadcast; m3 A4 below).
- PDF audit: no printed accents at those onsets — all slur/tie curve fragments (class 4).
- Controls: 12 true beat-1 accents retained.
- Fix in `detectNoteAnchoredRasterArticulations.js`: edge-isolation, tighter wedge geometry/asymmetry, denser staccato fill, multi-crumb abstain, near-head staccato gap (dy ≥ 2.05 staff spaces).
- Rejected along the way: row-probe curve contamination (killed true beat-1 staccatos).
- Result: scan A 86%→**100%** (12/12 accent + 12/12 staccato, 0 FP); corpus A 98.4%→**100%**; Overall 87.3%→**87.6%**; notes 88/88; Guitar P/R/M 100%; frozen 9/9; build/heavy PASS.
- Tuplets m8 residual rest/C5 mismatches confirmed closed benchmark-truth (do not reopen).
- Next: scan slur emission for different-pitch curves.

## Accepted: emit raster slurs from source-supported curves - 2026-08-05 (`3e75810`)

- Inventory: two printed different-pitch cross-bar slur bows on piano-articulation-scan (m1 F4→m2 G4 above; m3 A4→m4 A♯4 below). No same-pitch ties on the page.
- Root cause: raster path only ran `finalizeRasterPageTies`; tie ink-arc band/span too narrow for phrase bows; no slur emitter.
- Fix: new `finalizeRasterPageSlurs.js` — event-pair probe with wider band, side dominance, endpoint support, cross-bar half evidence, greedy non-overlapping ownership; wired after ties in `processOmrPage`.
- Result: both slurs emitted; incorrect-tie stays 0; articulations 12/12+12/12; notes 88/88; P/M 100%; corpus A 100% Overall 87.6%; original missing-tie 2→1 + tie-vs-slur×1 (benchmark MusicXML tie).
- Suite: same 5 pre-existing failures only; build/heavy PASS; Guitar P/R/M 100%.
- Next: scan volta-mismatch×2 if source-supported.

## Accepted: recognize scanned repeat endings - 2026-08-05 (`f091ee7`)

- Inventory: `SCAN_VOLTA_ENDING_INVENTORY.md` — PDF visibly prints m7 `1.` and m8 `2.` volta brackets with start hooks; forward m1 + backward m8 already recovered.
- Shared root cause: `detectVoltaEnding` required PDF text labels (`1.`/`2.`); scan `pageText` count = 0 → both endings null. Classification: production defect (bracket+label present), not benchmark truth.
- Fix: `detectRasterVoltaEnding.js` — joint evidence (long above-staff horizontal + start hook + local digit 1/2 classifier); wired as fallback after text path in `detectOmrRepeatBarline.js`. No broad OCR. Bare digits without bracket abstain.
- MusicXML: m7 ending 1 start/stop; m8 ending 2 start/stop + backward; repeats unchanged.
- Result: volta-mismatch 2→**0**; Overall 87.6→**88.2**; Interpretation 29.6→**34.1**; scan notes 88/88 P/M/A 100%; slurs/accents unchanged; Guitar P/R/M 100%; frozen 9/9; focused 17/17; full suite still exactly 5 pre-existing failures; build + heavy-score PASS.
- Source-supported high-value queue on frozen corpus: **empty**. Remaining original-corpus defects are closed benchmark-truth / policy (tempos, dense naturals, scan half/quarter, slur-as-tie MusicXML, tuplets m8 glyph mismatches). Do not reopen.

## PROGRAM CLOSEOUT — 2026-08-05 (`f091ee7`)

Stop condition reached: **SOURCE-FAITHFUL ZERO-DEFECT SUCCESS ON THE FROZEN CORPUS**.

- No production OMR changes during closeout against the nine-fixture corpus.
- Final untouched metrics: Overall 88.2%, Articulation 100%, volta-mismatch 0, scan 88/88 P/M/A 100%, Guitar paired/standard P/R/M 100%, source-faithful incorrect chords 0.
- Remaining original-corpus defects independently classified as benchmark/policy truth (tempos×9, dense hidden naturals≈26+26, scan half/quarter≈32, slur-as-tie MusicXML, tuplets m8 glyphs). Documented in `SOURCE_FAITHFUL_BENCHMARK_AUDIT.md`.
- Freeze regression added: `tests/sourceFaithfulZeroDefectBaseline.test.js`.
- Validation battery green except the identical five pre-existing unit failures (`omrVectorRhythm`×4, `notationFidelitySprint3`×1). Full suite is not claimed green.
- Next phase: unseen holdout-score validation — not further frozen-corpus optimization.
