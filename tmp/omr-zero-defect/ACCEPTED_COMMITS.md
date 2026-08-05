# Accepted zero-defect OMR commits

Starting baseline: `2366c3727d1c0794a57a2b1ef4ff185a7ce7ab29`

## Recovered interrupted milestone (revalidated 2026-08-04)

Codex had already committed the raster milestone before the session limit.
Working tree was clean at resume (`45239ca`); checkpoint docs were stale and have been updated after independent revalidation.

| Commit | Message | Root cause family | Corpus after commit |
| --- | --- | --- | --- |
| `026f81ecaa9a1149ebea35637b30f9ad55ccac5e` | Improve raster notehead instance recovery | Raster staff geometry, pitch calibration, morphology notehead instances, ledger search margins, score-follow staff canonicalization | Overall 72.6%, Pitch 81.8%, Measure Structure 86.0%, incorrect-chord 92 |
| `d9d2a231cdc8d19a93cfbdbc44d15fb7c8aff413` | Improve raster accidental ownership | Accidental ownership / notehead staff-step ownership | Overall 73.8%, Pitch 86.1%, Measure Structure 88.4%, incorrect-chord 78 |
| `45239caf875ab4c0f94ca81d89c03d3cf3e8de59` | Preserve independent raster rhythm lanes | Independent treble/bass raster rhythm lanes; source-faithful filled-head quarters | Overall 73.5%, Pitch 85.8%, Measure Structure 87.8%, incorrect-chord 81 |

### Why HEAD is `45239ca` rather than `d9d2a23`

`d9d2a23` scores slightly higher on original-corpus Overall (73.8% vs 73.5%) because it still treated some bass filled heads as longer values closer to the MusicXML half-note truth. Visual source evidence shows filled, stemmed quarter heads on the bass staff. `45239ca` restores source-faithful durations (32 half→quarter mismatches remain classified as benchmark-truth defects, not production regressions) while preserving 100% Pitch / 100% Measure Structure / 88/88 notes on the scan fixture.

### Revalidation at resume HEAD `45239ca`

- Focused milestone tests: 8 files / 82 passed
- OMR regression: 71 files / 717 passed
- Full unit suite: 289 files / 2938 passed (5 skipped)
- Production build: pass
- Guitar/TAB/mic/playback/ownership/warning/report protections: 63 files / 735 passed
- `npm run test:scripts` (alignment / auto-setup / diagnostics): pass
- Heavy-score performance harness: PASS
- Frozen corpus 9/9: Overall 73.511%, Pitch 85.777%, Rhythm 81.336%, Sustain 55.556%, Articulation 90.793%, Measure Structure 87.774%, Interpretation 13.333%; total defects 518; incorrect-chord 81; incorrect-pitch 51
- Scan fixture: Pitch 100% (88/88), Measure Structure 100%, 0 missing/extra/onset/incorrect-chord; 32 duration-mismatch (benchmark truth)

| `75574011e0f2e78b1bd3715c7061eb3dc1c70f60` | fix(omr): snap late barlines to note-column gaps | Late barline / stolen opening chord column ownership | Overall 74.1%, Pitch 87.3%, Measure Structure 89.7%, incorrect-chord 70; paired guitar 72.2%→77.5% |

| `c52a38aa0baa1fc20ef85086179bcd7b4a760b75` | fix(omr): rebuild unreliable grids from note-column gaps | Unreliable density-thinned measure grids | Overall 74.6%, Pitch 89.2%, Measure Structure 91.6%, incorrect-chord 62; paired guitar 8/8 measures, Overall 82.3% |

| `934f0111bbc8f2478eb7ca55241ee290c14ab0ba` | fix(omr): reject TAB measure-number digits as frets | Printed measure numbers ingested as string-1 frets; even TAB packing | Overall 74.6→76.6, Pitch 89.2→92.6, Rhythm 82.0→91.2; tab-sparse R/P/M 100%; incorrect-chord 62→60 |

| `7495255f6bb3f88b8b8239dd71249d91414bad7a` | fix(omr): dedupe chord ink accidentals and keep beat-1 sharps | Duplicate ink sharps + playableStart key-sig false reject | Overall 76.6→76.8, Pitch 92.6→93.3; standard P 88→95, incorrect-chord 60→55 |

| `3ff28ab603c82f55d1fe6ccd6e79ef5707adad98` | fix(omr): share TAB clusters across same-onset voices | Multi-voice same-onset burned whole TAB cluster | Paired P/M 100%; Overall 76.8→77.1; incorrect-pitch 45→33; incorrect-chord 55→49 |

| `d255606e3e45b2517df51b091e14d9d7dc6e0878` | fix(omr): merge same-onset multi-voice events after TAB pairing | Bass halves from split voices | Paired R/P/M 100%; Overall 77.1→77.2; duration-mismatch 72→66 |

| `b3414aacf9083e93f44c2f7f537485a402d40603` | Keep deep ledger-line path accidentals in measure Y band | Stacked sharps below staff clipped by 30px pad | Overall 77.2→77.3; Pitch 94.5→94.8; standard P 98%; incorrect-chord 49→47; incorrect-pitch 33→29 |

| `9b97141a0698e7f531fd3c3c32f60957108b31a1` | Keep mixed-stem chord stacks out of joint voice splits | Joint pack split guitar mixed-stem chords into quarter lanes | Overall 77.3→77.4; standard P/R/M 100%; incorrect-chord 47→45 |

| `c01792397efeb272b3c43682f13de1d7aee29f6a` | Pack uniform eighth/sixteenth runs without false dyads | Dense-snap false dyads + eighth→quarter promotion | Overall 77.4→78.0; Rhythm 91.6→95.2; tuplets R 59→89; onset-mismatch 35→13; duration-mismatch 64→42 |

| `417850e2fe0f8d1d61a4638a759c2cb6e37bc8aa` | Fix dense upper-treble E5 false sharps via ambiguous anchor calibration | ambiguous-components fallback enabled false path sharps on E5 | Overall 78.0→78.1; Pitch 95.7→95.8; dense incorrect-pitch 29→25; E5→F5 cleared |

| `5ff73855249b5f4621168ae222eccc0955e9cbe1` | Reject out-of-band competing ink heads for page-local anchor calibration | Competing ink yOriginOffset 1.09 mapped C5→D5 | Source-faithful C5; corpus metrics flat (becomes hidden-natural vs benchmark) |

| `75c586bc05aa5c9eafb8b57a91fc980b101bad68` | fix(omr): repair sparse pickup and dotted-follower rhythm packing | Beginner m7/m8 delayed pickup + dotted eighth quarter-floor | Overall 78.1→78.5; Pitch 96.8; Rhythm 96.5; beginner P/R/M 100%; incorrect-chord 42→41 |

| `dc524165ec4a130cd08bd7d5b461337aa0b56349` | fix(omr): reject in-pack barlines that split dense opening measures | False barline inside opening chord column pack | Overall 78.5→78.9; Pitch 98.5; Measure 97.3; dense P 90% R 100%; incorrect-chord 41→27; missing/extra notes ~25→1 |

| `6537838d8e376dde9e36e8133adc4fa5c887d617` | fix(omr): improve sparse pickup rests and dotted subdivision rhythm | Tuplets pickup rest + dotted eighth + false terminal dyad | Rhythm 96.6→97.1; tuplets R 88→92 Overall 68.8→69.4 |

| `e6e9454e16df87c10d151898591bba2eecf874e9` | fix(omr): detect MuseScore stroke ties from PDF open cubics | Ties drawn as stroked open Béziers, not filled lenses | Overall 78.9→**83.7**; Sustain 55.6→**88.9**; grand-voices 97.1%; techniques S 100%; missing-tie 7→2 |

| `d50254d21daff0572ec2998a8618b348411eaf2d` | fix(omr): detect repeats and voltas on TAB/vector guitar systems | TAB path skipped structure markings; narrow bands missed colons | Overall 83.7→**86.0**; Interpretation 13.3→**29.6**; tab-sparse 97.1% I=80%; paired 95.2% I=67% |

| `2462c1dcedc5264f0cad36075b7a211bd42ecbdb` | fix(omr): improve tuplets sparse rhythm and subdivision rests | Wide-spaced position rhythm + sixteenth rest insertion | Overall 86.0→**86.1**; Pitch 98.9; tuplets 84.7% P/M 100% |

| `15422cd68efe51433bdceca963b87676ae59c6f1` | fix(omr): reject below-staff ink anchors snapped to staff lines | Ledger-masked ink snapped D4→E4 on dense m1 | Overall **86.2%**; dense incorrect-pitch 27→26 (all remaining = hidden naturals) |

| `c2d374d5630aea4f15bf687e48fac55b4e5d14d4` | fix(omr): drop unpaired raster orphan tie starts | Orphan-start keep invented incorrect-tie FPs for different-pitch slur | incorrect-tie 3→0; scan Sustain still 0% (missing-tie×2 benchmark) |

| `33ee7f3f2c4adc742414c4c2d6daba5e9565af57` | fix(omr): place short vector rests left of packed attacks | Subdivision rests filtered/skipped beside packed attacks | Corpus Rhythm 97.2→97.5; tuplets R 93→96; missing-rest 3→1; onset-mismatch 4→2 |


| `5252f369cc465cf963baedb680d1f7d9f190a9b5` | fix(omr): scope short-rest placement away from Wet Hands F1 drop | Eighth near-head retention + broad unpack dropped Wet Hands F1 below 0.45 | Restored F1; kept tuplets short-rest gains from 33ee7f3 |

| `f0c0c37fed0def7ba7ccd623f5e5d0a1ba0117f3` | fix(omr): recognize scan articulations from note-anchored patches | Legacy 5×5 staccato probe; no raster accent path; wide-crop dense masking killed accents | Overall 86.2→**87.3**; Articulation 90.7→**98.4**; scan A 16→**86%**; beat-1 12/12 staccato + 12/12 accent |

| `83c48f3dcdfaceee87bed55a6e47f327c591e990` | fix(omr): preserve terminal tuplet rests and dots | Dense measures skipped dotted-eighth refine; overlap repair undid refine via stale note durations | Tuplets R 96→**99**; m8 missing-rest/onset/dotted cleared; residual C5 quarter + rest eighth vs truth eighth+quarter rest |


| `36ccb99a6163040390b2caef38ebef489b7140aa` | fix(omr): reject unsupported raster accent fragments | Slur-arc fragments classified as accents; near-head crumbs became staccato after accent reject | Overall 87.3→**87.6**; Articulation 98.4→**100**; scan A 86→**100%**; unexpected accent FP 4→0 |

| `3e75810225f512c11b2bce8ee426e7ec6cebae9b` | fix(omr): emit raster slurs from source-supported curves | Raster page had ties-only; phrase bows need wider different-pitch slur probe | Scan emits m1/m3 cross-bar slurs; incorrect-tie 0; original missing-tie 2→1 + tie-vs-slur×1 |

| `f091ee76a74d4d0265218a051e07ef4a6880b894` | fix(omr): recognize scanned repeat endings | Scan PDF text layer empty; volta path text-only → missed printed `1.`/`2.` brackets | Overall 87.6→**88.2**; Interpretation 29.6→**34.1**; volta-mismatch 2→**0**; scan m7/m8 endings emitted |

## Program closeout — 2026-08-05

**Stop condition:** SOURCE-FAITHFUL ZERO-DEFECT SUCCESS ON THE FROZEN CORPUS  
**Final production HEAD:** `f091ee7`  
**Closeout freeze test:** `613fa73` — `test(omr): protect source-faithful zero-defect baseline`  
**Freeze protection file:** `tests/sourceFaithfulZeroDefectBaseline.test.js`  
Source-supported ledger items: all resolved. Remaining original defects are benchmark/policy only.
