# OMR V3 Accuracy Campaign — Stress Validation

Date: 2026-07-16  
Scope: all 20 benchmark-dashboard fixtures, repeated real-PDF timing checks, and visual inspection of representative PDF pages.

## Result

The targeted fixes generalize beyond the six original regressions.

- Enforced dashboard fixtures: **10 pass, 0 fail, 0 error**.
- Remaining enforced V3 regressions: **0**.
- V3-ready enforced fixtures: **9 of 10**; `guitar-paired-scan` remains unavailable because the production detector honestly rejects it before a V3 shadow document can be captured.
- Invalid V3 events: **0**.
- Duplicate V3 events: **0**.
- V3 voice-overlap violations: **0**.
- Diagnostic fixtures: **10 skipped as designed**, with no fake pass or truth substitution.

The promotion gate remains `shadow-only`. It requires two improved enforced fixtures and complete enforced shadow availability; the current result has one improved fixture and one unavailable fixture. Neither rule was changed.

## Enforced regression validation

The complete enforced set was rerun after the structural changes. Eight ready fixtures are at exact V2 parity on every enforced metric. `piano-dense-advanced-vector` still improves all six gate axes:

| Metric | V2 | V3 |
| --- | ---: | ---: |
| Pitch accuracy | 0.1477 | 0.1970 |
| Duration accuracy | 0.3939 | 0.6174 |
| Onset accuracy | 0.3333 | 0.4848 |
| Chord grouping | 0.2892 | 0.4594 |
| Note F1 | 0.4563 | 0.7102 |
| Absolute measure error | 11 | 2 |

The paired Guitar fixtures also retain structural evidence that the legacy output cannot express:

- `guitar-paired-chords-vector`: 81 of 91 notation events paired with TAB evidence (89.01% recall), with one musical timeline and no duplicate events.
- `guitar-techniques-paired-vector`: 28 of 28 notation events paired (100% recall), with one musical timeline and no duplicate events.

During stress validation, explicit incomplete-staff recovery was narrowed to its safe context: an unpaired incomplete Piano band remains ambiguous, while a detector-owned Guitar notation band or a provenance-linked grand staff can recover. Geometry remains the first owner for Piano symbols; detector staff ownership is a fallback only when geometry cannot produce a safe owner. Guitar uses its explicit notation/TAB owner because paired vertical geometry is intentionally overlapping. This restored the pre-campaign dense-Piano shadow metrics while keeping all six regressions eliminated.

## Diagnostic corpus comparison

The checked-in diagnostic fixtures improved broadly rather than only on the six enforced cases.

| Fixture | Baseline V3 | Accuracy-campaign V3 |
| --- | --- | --- |
| `clean` | 0.5906 pitch, 0.7719 duration, 0.8102 onset, 0.8102 F1, measure error 11 | Exact runtime parity on all axes, measure error 0 |
| `dense` | 0.1907 pitch, 0.7167 duration, 0.6523 onset, 0.8635 F1, measure error 10 | 0.1964 pitch, 0.7338 duration, 0.6655 onset, 0.8718 F1, measure error 3 |
| `simple` | Runtime parity | Runtime parity |
| `wet-hands-guitar` | 0.0816 TAB-pair recall, 30 voice overlaps, measure error 10 | 0.9592 TAB-pair recall, 0 voice overlaps, measure error 5 |
| `campanella-grandes` | 0.2063 F1, measure error 196 | 0.7684 F1, measure error 8 |
| `campanella-etude` | 0.3480 F1, measure error 90 | 0.4107 F1, measure error 52 |

These are diagnostic observations, not new accuracy claims or promotion thresholds.

## Real-PDF outcomes

| Category | Fixture | Baseline | After | Assessment |
| --- | --- | --- | --- | --- |
| Orchestral vector | Beethoven Symphony No. 7 | Rejected, confidence 0.6391 | Rejected, confidence 0.6419 | Stable safe rejection; full orchestral-part support remains out of scope. |
| Dense engraved Piano | Beethoven Pathétique | Rejected, confidence 0.6545 | Rejected, confidence 0.6572 | Stable safe rejection; dense ornaments, beams, tuplets, and voice texture remain difficult. |
| Historical scanned Piano | Twinkle, 1880 | 421 notes, 98 measures, confidence 0.6212 | 421 notes, 98 measures, confidence about 0.623 | Stable recognition; 41 measures remain rhythm-uncertain. |
| Beginner engraved Piano | Local beginner workbook | 585 notes, 113 measures, confidence 0.9055 | 585 notes, 113 measures, confidence 0.9059 | Stable high-confidence recognition. |

Visual PDF inspection confirmed that these categories are materially different: a 12-part orchestral system with watermark text, dense engraved Pathétique grand staffs, a skewed/noisy historical scan with cover material, and a clean beginner grand-staff worksheet. The observed rejection/recognition behavior matches the visible difficulty rather than a fixture-specific exception.

## Performance and memory

Full-corpus wall time remained stable and then improved on the confirmation run:

- Baseline: **32.59 s** real, 34.64 s user, 0.95 s system.
- First post-fix stress run: **32.93 s** real, 35.49 s user, 0.91 s system.
- Confirmation run: **28.64 s** real, 31.69 s user, 0.79 s system.

The first post-fix delta was +1.0%, within run-to-run variance; the confirmation was 12.1% faster than baseline. Repeated recognized-PDF runs preserved identical pages, measures, and notes. Twinkle ranged from 599–798 ms and the beginner workbook from 607–870 ms, showing that individual `performance.now()` samples are noisy while complete-corpus timing is stable.

The confirmation run reported 1,576,517,632 bytes maximum resident set size and zero swaps. No raster buffers, image copies, preprocessing passes, or worker messages were added. New memory is bounded scalar provenance plus transient event-lane arrays (`O(symbols + events)`), not page-sized image allocation. Worker execution and production output remain unchanged because V3 is still shadow-only.

## Remaining stress weaknesses

- Multi-part orchestral scores are still safely rejected rather than partially transcribed.
- Very dense engraved Piano remains below the confidence required for import.
- Historical scans can recognize, but rhythm uncertainty remains high and decorative/title pages still consume page-processing work.
- The paired Guitar scan still cannot reach V3 because the upstream detector emits an honest no-notes rejection.
- Diagnostic legacy pieces still expose absolute measure-count errors even where the campaign substantially reduced them.

These weaknesses are retained as explicit qualification blockers; no threshold was lowered and no fixture was special-cased.
