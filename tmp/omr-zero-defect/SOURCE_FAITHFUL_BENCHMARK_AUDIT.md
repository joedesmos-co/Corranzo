# Source-faithful benchmark audit (closeout f091ee7)

Evaluator frozen at 2.0.0 / schema 2. Truth files and tolerances were **not** edited.

Two metric views:

1. **Original untouched benchmark** — raw evaluator vs current MusicXML truth files  
2. **Source-faithful audited view** — exclude defects contradicted by visible PDF evidence

---

## View 1 — Original untouched (HEAD `f091ee7`)

| Metric | Value |
| --- | ---: |
| Overall | 88.2% |
| Pitch | 98.9% |
| Rhythm | 97.8% |
| Sustain | 88.9% |
| Articulation | 100.0% |
| Measure Structure | 97.7% |
| Interpretation | 34.1% |
| Fixtures | 9/9 |

| Defect code | Count | Fixtures |
| --- | ---: | --- |
| duration-mismatch | 33 | piano-articulation-scan (32), piano-rhythm-tuplets-vector (1) |
| incorrect-chord | 26 | piano-dense-advanced-vector |
| incorrect-pitch | 26 | piano-dense-advanced-vector |
| tempo-mismatch | 9 | all 9 fixtures |
| missing-tie | 1 | piano-articulation-scan |
| tie-vs-slur-confusion | 1 | piano-articulation-scan |
| rest-duration-error | 1 | piano-rhythm-tuplets-vector |
| volta-mismatch | 0 | — |
| incorrect-tie | 0 | — |
| missing-accent / missing-staccato | 0 | — |

Campaign start (`2366c37`): Overall 71.1%, incorrect-chord 122, Articulation 90.6%, scan Overall 42.7%.

---

## View 2 — Source-faithful audited

After excluding the benchmark/policy clusters below:

| Metric | Source-faithful |
| --- | ---: |
| Source-supported production defects remaining | **0** |
| Source-faithful incorrect chords | **0** |
| Scan notes / Pitch / Measure / Articulation | 88/88 · 100% · 100% · 100% |
| Guitar paired / standard P·R·M | **100%** |
| Scan voltas / accents / slurs | recovered source-faithfully |
| Incorrect ties | **0** |

Remaining original-corpus defects are **not** production OMR failures against the printed PDF.

---

## Excluded benchmark / policy defects

### A. Unprinted tempo expectations ×9

| Field | Value |
| --- | --- |
| Fixture | Every frozen fixture (×1 each) |
| Measure / event | Typically measure 1 tempo / metronome marking |
| Original expected | Printed or implied tempo matching MusicXML `<sound tempo>` / direction |
| Visible PDF evidence | No tempo word / metronome mark engraved on these fixture PDFs |
| Source-faithful result | Default / absent tempo (OMR does not invent unprinted tempos) |
| Classification | **Policy / benchmark truth** |
| Why not imitate | Emitting a tempo not present on the PDF invents interpretation |

### B. Dense hidden-natural expectations ≈×26 incorrect-pitch + ×26 incorrect-chord

| Field | Value |
| --- | --- |
| Fixture | `piano-dense-advanced-vector` |
| Measure / event | Dense upper-treble chord stacks (high-extreme register; measures such as 3, 6, 7 prominently) |
| Original expected | Cancelling **natural** accidentals restoring diatonic pitch after prior sharps within the measure |
| Visible PDF evidence | No natural glyphs printed at those heads; prior sharps remain in measure state |
| Source-faithful result | Retained sharp / altered pitch matching printed accidentals + measure state |
| Classification | **Benchmark truth** (MusicXML encodes unprinted cancellations) |
| Why not imitate | Forcing hidden naturals would invent accidentals absent from the PDF |

### C. Scanned half-versus-quarter duration expectations ≈×32

| Field | Value |
| --- | --- |
| Fixture | `piano-articulation-scan` |
| Measure / event | Staff-2 (bass) filled heads across measures 1–8 (32 half expectations) |
| Original expected | MusicXML `half` durations |
| Visible PDF evidence | Filled black noteheads with stems — printed as **quarters**, not open half heads |
| Source-faithful result | Quarter durations |
| Classification | **Benchmark truth** |
| Why not imitate | Matching MusicXML halves would misread filled heads as open notes |

### D. PDF slur encoded as MusicXML tie (×1 missing-tie + ×1 tie-vs-slur)

| Field | Value |
| --- | --- |
| Fixture | `piano-articulation-scan` |
| Measure / event | m3 A4 → m4 A♯4 (different pitch) |
| Original expected | MusicXML `<tie>` between those notes |
| Visible PDF evidence | Phrase **slur** bow between different pitches; no same-pitch tie |
| Source-faithful result | `<slur>` emitted; no incorrect-tie |
| Classification | **Benchmark encoding error** |
| Why not imitate | Emitting a tie for a different-pitch slur is musically wrong and creates incorrect-tie FPs |

(Related: m1 F4 → m2 G4 slur is also printed and now emitted; not a remaining original defect once emitted.)

### E. Tuplets measure 8 rest / C5 duration (×1 rest-duration-error + ×1 duration-mismatch)

| Field | Value |
| --- | --- |
| Fixture | `piano-rhythm-tuplets-vector` |
| Measure / event | Measure 8 terminal rest + C5 |
| Original expected | Quarter rest + C5 eighth (MusicXML) |
| Visible PDF evidence | Page text/glyphs: `U+E4E6` **eighth** rest; unbeamed black C5 head with **no** flag glyphs on the page |
| Source-faithful result | Eighth rest + quarter-class filled head matching printed ink |
| Classification | **Benchmark truth** (glyph contradiction) |
| Why not imitate | Changing recognition to match MusicXML would deny the printed SMuFL rest and unflagged head |

---

## Source-supported items resolved (ledger closed)

| Cluster | Status |
| --- | --- |
| Raster noteheads / pitch / chords (scan) | Resolved |
| Raster accidentals / lanes / barlines | Resolved |
| Guitar TAB / paired / standard ownership | Resolved |
| Vector ties / stroke ties | Resolved |
| Repeats / voltas (vector + scan) | Resolved |
| Scan articulations (staccato + accent) | Resolved |
| Scan slur emission | Resolved |
| Tuplets source-supported rest/onset/dot cluster | Resolved (residuals = E above) |

**Source-supported remaining: none.**
