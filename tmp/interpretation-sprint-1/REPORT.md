# Musical Structure / Interpretation Sprint 1

## Status
**ACCEPTED and frozen (2026-07-26).** Basic repeats and first/second endings are locked.
Do not revisit Interpretation Sprint 1 unless a real regression is demonstrated.
Guitar Mapping Sprint 1 remains frozen. Semantic evaluator remains frozen (`2.0.0` / schema `2`).
Follow-on: **Dynamics Recognition Sprint 1**.
Deferred (not Structure): D.C./D.S./Segno/Coda/Fine; guitar measure-split repeat alignment; two `guitar-standard` false ties.

## Baseline (pre-sprint, from Mapping Sprint 1 freeze)
| Class | Mean |
| --- | ---: |
| Overall | 60.0% |
| Pitch | 58.4% |
| Rhythm | 65.2% |
| Sustain | 46.7% |
| Articulation | 83.9% |
| Measure Structure | 66.1% |
| **Interpretation** | **0.0%** |

Interpretation defects: `repeat-mismatch` ×8 (4 fixtures), `volta-mismatch` ×6 (3 fixtures), `tempo-mismatch` ×8 (8 fixtures).

## RCA (root causes fixed)

### Written structure
1. **Vector OMR never attached repeat/volta markings** — raster path called detectors; vector path returned early without them. Most corpus fixtures are vector-glyphs.
2. **Repeat detector used a fixed 3px bar gap and mid-system Y** — real MuseScore renders use ~5–8px thin/thick clearance; dots sit on a staff or in the inter-staff gap, not at system midY. Staff-line crossings also faked colon hits.
3. **Volta endings were ink-heuristic only (confidence 0.72 < emit threshold 0.78)** — never emitted. Real scores expose `"1."` / `"2."` in the PDF text layer above the staff.

### Performed order
4. **Backward repeat on a skipped second ending never fired** — `skipForVolta` continued past the measure without processing `backwardRepeat`, so structures like grand-voices (ending 2 carries the backward) never expanded.

## Fixes (general, no fixture hardcoding)
1. `detectOmrRepeatBarline.js` — variable-gap double-bar runs; colon detection with staff-line rejection, gap-first multi-staff search, both-staves gate; PDF-text volta labels; ending-stop finalization.
2. `processOmrPage.js` — attach structure markings on **vector and raster** paths via shared helper.
3. `buildOmrMusicXml.js` — emit `endingStop` / numbers; preserve written measures (no expansion in MusicXML).
4. `parseMeasureRepeats.js` — honor backward on skipped **later** endings only (does not re-jump when skipping earlier endings on later passes).

## Representations (kept separate)
| Layer | Behavior |
| --- | --- |
| Written score structure | MusicXML measures + `<repeat>` / `<ending>` on barlines as printed |
| Performed playback order | `buildPerformedMeasureTimeline` expands visits; does **not** duplicate written measures |

## After metrics (frozen corpus)
| Class | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Overall | 60.0% | **61.9%** | +1.9 pp |
| Pitch | 58.4% | 58.4% | 0 |
| Rhythm | 65.2% | 65.2% | 0 |
| Sustain | 46.7% | 46.7% | 0 |
| Articulation | 83.9% | 83.9% | 0 |
| Measure Structure | 66.1% | 66.1% | 0 |
| **Interpretation** | **0.0%** | **13.3%** | **+13.3 pp** |

### Interpretation defect counts
| Code | Before | After |
| --- | ---: | ---: |
| repeat-mismatch | 8 | **4** |
| volta-mismatch | 6 | **4** |
| tempo-mismatch | 8 | 9 |

### Headline fixtures
| Fixture | Written marks | Performed order | I score |
| --- | --- | --- | ---: |
| `piano-grand-voices-vector` | forward m1; ending1 m7; ending2+backward m8 — **exact match** | `1–7,1–6,8` — **exact match** | 0% → **80%** |
| `piano-articulation-scan` | forward + backward found; voltas partial (scan/text weak) | expands with remaining volta gaps | 0% → **40%** |
| `guitar-paired-chords-vector` | forward m1 + backward on last OMR measure | expands OMR’s 5 written measures (truth has 8; measure split is Measure Structure) | still 0% (alignment) |

Playback duration expands with repeats (grand: written ~16s OMR clock → performed ~28s at OMR tempo; truth tempo differs so absolute seconds are not the gate).

## Tests
- `tests/interpretationSprint1.test.js` — detection, emission, ordinary double-bar negative, articulation-dot negative, malformed fail-safe, fixture expansion suite
- `tests/timelineExpansion.test.js` — backward-on-second-ending; pickup then repeat
- Existing `pdfOmrMusical` + timeline suite green

## Remaining unsupported / deferred
- D.C. / D.S. / Segno / Coda / Fine / nested repeat graphs
- Tempo recognition (still dominant residual Interpretation defect)
- Guitar fixtures where measure split prevents repeat markers from aligning to truth measure numbers
- Scanned voltas without a reliable `"N."` text label
- Ink-only volta fallback intentionally disabled (too many FPs)

## Acceptance
- [x] Interpretation improved from baseline (0% → 13.3%)
- [x] Simple repeat performed order correct
- [x] First/second endings work where supported (grand exact)
- [x] No infinite loops (malformed fail-safe tested)
- [x] Written pitches/durations unchanged (Pitch/Rhythm/Sustain/Articulation/Measure Δ = 0)
- [x] No other semantic class drop >1 pp
- [x] Evaluator untouched
- [x] No fixture-specific hardcoding

## Next sprint reassessment
**Prefer Dynamics recognition** over D.C./D.S./Coda/Fine for practical playback payoff.
Remaining Interpretation mass is mostly `tempo-mismatch` plus measure-alignment limits on guitar; navigation marks (D.C./D.S.) are rare in the current corpus relative to dynamics that affect every note.
Keep Guitar Mapping frozen; keep the two `guitar-standard` false ties as a future Sustain note (not Structure).
