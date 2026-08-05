# ZERO-DEFECT OMR REPORT — FINAL CLOSEOUT

**Program:** Corranzo AUTONOMOUS ZERO-DEFECT OMR PROGRAM  
**Stop condition:** **SOURCE-FAITHFUL ZERO-DEFECT SUCCESS ON THE FROZEN CORPUS**  
**Status:** Closed  

| | Hash |
| --- | --- |
| Original starting HEAD | `2366c3727d1c0794a57a2b1ef4ff185a7ce7ab29` |
| Final production HEAD | `f091ee76a74d4d0265218a051e07ef4a6880b894` |
| Closeout freeze test commit | `613fa73b043d99a3c783740fa27df6b01ae06439` |

Evaluator / schema unchanged: frozen **2.0.0** / schema **2**. Truth files not edited.

Full source-faithful exclusion table: `SOURCE_FAITHFUL_BENCHMARK_AUDIT.md`.

---

## 1. Original baseline → final untouched metrics

| Metric | Start `2366c37` | Final `f091ee7` |
| --- | ---: | ---: |
| Overall | 71.1% | **88.2%** |
| Pitch | 75.7% | **98.9%** |
| Rhythm | 81.2% | **97.8%** |
| Sustain | 55.6% | **88.9%** |
| Articulation | 90.6% | **100.0%** |
| Measure Structure | 81.2% | **97.7%** |
| Interpretation | 13.3% | **34.1%** |
| incorrect-chord | 122 | **26** (all dense hidden-natural benchmark) |
| volta-mismatch | 4 | **0** |
| Fixtures | 9/9 | 9/9 |

### Source-faithful audited view (final)

| Outcome | Value |
| --- | --- |
| Source-supported production defects remaining | **0** |
| Source-faithful incorrect chords | **0** |
| Scan notes / Pitch / Measure / Articulation | 88/88 · 100% · 100% · 100% |
| Guitar paired / standard P·R·M | **100%** |
| Incorrect ties | **0** |
| Unexpected scan accents | **0** |

---

## 2. Raster scan before / after

| | Start | Final |
| --- | ---: | ---: |
| Overall (fixture) | 42.7% | **80.3%** |
| Pitch | 27% | **100%** (88/88) |
| Measure Structure | 47% | **100%** |
| Articulation | 15% | **100%** (12/12 staccato + 12/12 accent) |
| Notes | chaotic extras/misses | **88/88** |
| Slurs | none | m1 F4→m2 G4; m3 A4→m4 A♯4 as **slur** |
| Voltas | missing | m7 ending 1; m8 ending 2 + backward |
| Repeats | partial | forward m1 + backward m8 |

---

## 3. Guitar before / after

| Fixture | Start (approx) | Final P/R/M |
| --- | --- | --- |
| guitar-paired-chords-vector | P 58% M 55% | **100% / 100% / 100%** |
| guitar-standard-chords-vector | P 90% M 89% | **100% / 100% / 100%** |
| guitar-tab-sparse-vector | R 17% | **100% / 100% / 100%** |
| guitar-techniques-paired-vector | S 0% (ties) | **S 100%**; P/R/M 100% |

---

## 4. Capability recovery summary

| Area | Outcome |
| --- | --- |
| Accidentals | Dense path sharps, ledger bands, ink dedupe, TAB measure-number rejection |
| Ties | MuseScore stroke cubics; orphan raster starts dropped; incorrect-tie → 0 |
| Slurs | Raster different-pitch bows emitted; not forced to MusicXML ties |
| Articulations | Note-anchored staccato + accent; FP slur crumbs rejected |
| Repeats | Forward/backward on scan + TAB/vector guitar |
| Voltas | Text path + raster bracket/hook/digit for scans |

---

## 5. Every accepted commit (campaign `2366c37` → `f091ee7`)

See also `ACCEPTED_COMMITS.md` for per-commit corpus deltas.

1. `026f81e` — Improve raster notehead instance recovery  
2. `d9d2a23` — Improve raster accidental ownership  
3. `45239ca` — Preserve independent raster rhythm lanes  
4. `7557401` — snap late barlines to note-column gaps  
5. `c52a38a` — rebuild unreliable grids from note-column gaps  
6. `934f011` — reject TAB measure-number digits as frets  
7. `7495255` — dedupe chord ink accidentals and keep beat-1 sharps  
8. `3ff28ab` — share TAB clusters across same-onset voices  
9. `d255606` — merge same-onset multi-voice events after TAB pairing  
10. `b3414aa` — Keep deep ledger-line path accidentals in measure Y band  
11. `9b97141` — Keep mixed-stem chord stacks out of joint voice splits  
12. `c017923` — Pack uniform eighth/sixteenth runs without false dyads  
13. `417850e` — Fix dense upper-treble E5 false sharps  
14. `5ff7385` — Reject out-of-band competing ink heads for anchor calibration  
15. `75c586b` — repair sparse pickup and dotted-follower rhythm packing  
16. `dc52416` — reject in-pack barlines that split dense opening measures  
17. `6537838` — improve sparse pickup rests and dotted subdivision rhythm  
18. `e6e9454` — detect MuseScore stroke ties from PDF open cubics  
19. `d50254d` — detect repeats and voltas on TAB/vector guitar systems  
20. `2462c1d` — improve tuplets sparse rhythm and subdivision rests  
21. `15422cd` — reject below-staff ink anchors snapped to staff lines  
22. `c2d374d` — drop unpaired raster orphan tie starts  
23. `33ee7f3` — place short vector rests left of packed attacks  
24. `5252f36` — scope short-rest placement away from Wet Hands F1 drop  
25. `f0c0c37` — recognize scan articulations from note-anchored patches  
26. `83c48f3` — preserve terminal tuplet rests and dots  
27. `36ccb99` — reject unsupported raster accent fragments  
28. `3e75810` — emit raster slurs from source-supported curves  
29. `f091ee7` — recognize scanned repeat endings  

---

## 6. Rejected experiments

| Experiment | Why rejected |
| --- | --- |
| Joint raster articulation instances | Articulation 17%→≤10%; fully reverted |
| Terminal rest capacity shrink to force quarter (tuplets m8) | PDF glyph is `U+E4E6` eighth — would imitate benchmark |
| Row-probe curve contamination for staccato | Killed true beat-1 staccatos |
| Emitting ties for different-pitch slur bows | Musically wrong; creates incorrect-tie FPs |
| Hidden-natural “fixes” on dense fixture | Unprinted naturals — benchmark imitation |
| Half durations on filled scan bass heads | Printed quarters — benchmark imitation |
| Inventing unprinted tempos | Policy / not on PDF |

---

## 7. Benchmark-truth audit (remaining original defects)

| Cluster | Count | Classification |
| --- | ---: | --- |
| Unprinted tempos | 9 | Policy |
| Dense hidden naturals | ~26 pitch + ~26 chord | Benchmark |
| Scan half vs quarter | ~32 | Benchmark |
| Slur as MusicXML tie (m3→m4) | missing-tie×1 + tie-vs-slur×1 | Benchmark encoding |
| Tuplets m8 rest/C5 vs glyphs | 2 | Benchmark |

Details: `SOURCE_FAITHFUL_BENCHMARK_AUDIT.md`.

---

## 8. Performance impact

- Heavy-score performance harness: **PASS** (hot parse cache, visual windowing budgets green)
- Representative supplied-PDF processing: scan 88 notes / paired 116 / beginner 32 — all `accepted`
- No closeout production OMR changes; freeze tests only

---

## 9. Complete validation (closeout)

| Check | Result |
| --- | --- |
| Frozen semantic corpus 9/9 | **PASS** (Overall 88.2%) |
| Focused program tests (12 files / 136) | **PASS** |
| Freeze baseline `sourceFaithfulZeroDefectBaseline` | **PASS** (5) |
| OMR regression (~86 files) | 5 fail = known baseline only; 908 pass |
| Full unit suite | **5 failed / 3021 passed / 5 skipped** (292 files) |
| Production build | **PASS** |
| Evaluator integrity + CLI self-check | **PASS** |
| Guitar paired / standard / TAB protections | **PASS** |
| Microphone / playback / tie-slur semantics | **PASS** |
| Ownership / instrument-switch | **PASS** |
| Report / export / warnings / acceptance | **PASS** |
| Repeat / volta tests | **PASS** |
| Heavy-score harness | **PASS** |
| Representative PDF processing | **PASS** |

### Known pre-existing suite failures (identical; not part of closeout)

1–4. `tests/omrVectorRhythm.test.js` ×4  
5. `tests/notationFidelitySprint3.test.js` ×1  

**Full suite is not green.** These five remain unrelated and unresolved.

---

## 10. Stop condition

**SOURCE-FAITHFUL ZERO-DEFECT SUCCESS ON THE FROZEN CORPUS**

No remaining source-supported production defects on the nine-fixture frozen corpus.  
Further Overall gains require holdout validation or separate policy/benchmark truth work — **not** more OMR optimization against these nine fixtures.

### Next recommended phase

**Validation on unseen holdout scores** (new PDFs / corpora outside the frozen nine), with the freeze baseline tests as the regression gate.
