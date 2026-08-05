# Scan Volta Ending Inventory

**HEAD at inventory:** `3e75810`  
**Fixture:** `piano-articulation-scan`  
**Source PDF:** `benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf`  
**Truth MusicXML:** `benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.musicxml`

## Evaluator mismatches (×2)

| Measure | Code | Expected | Generated |
|--------:|------|----------|-----------|
| 7 | `volta-mismatch` | ending `1` start+stop | no `<ending>` |
| 8 | `volta-mismatch` | ending `2` start+stop + backward repeat | backward repeat only; no `<ending>` |

Generated already has: forward repeat on m1, backward repeat on m8. Endings are the sole gap.

## PDF text layer

`pageText` count = **0** (image-only scanned PDF).  
`detectVoltaFromText` cannot fire. Shared failure mechanism for both mismatches.

## Visual source inventory

Page 1, system 1 (lower grand-staff system), measures 5–8. Staff top ≈ y=686 @ 1000×1294 analysis.

### Measure 1 (system 0) — forward repeat

| Field | Observation |
|-------|-------------|
| Printed forward repeat | Yes (thick bar + colon) |
| Ending bracket | None |
| Generated | `forwardRepeat` recovered — OK |

### Measure 7 — first ending

| Field | Observation |
|-------|-------------|
| Page / system / staff | 1 / 1 / treble+bass grand |
| Measure numbers | 7 |
| Printed repeat barlines | None on m7 (ordinary barlines) |
| Printed ending bracket | Yes — horizontal above staff |
| Bracket start (approx px) | x≈513–517, y≈672–673 |
| Bracket end (approx px) | near x≈713 (barline to m8), y≈672 |
| Horizontal span | ~full measure width (~200 px), dens≈0.73–0.75 |
| Vertical stroke at start | Yes (~12–13 px down) |
| Vertical stroke at end | Yes (short stop hook at m7\|m8 barline) |
| Ending label text | `1.` |
| Label provenance | Raster ink only (no PDF text/glyph) |
| Measures under bracket | 7 only |
| Expected MusicXML | `ending number="1" type="start"` (left) + `stop` (right) |
| Generated | null ending |
| Repeat direction | none on m7 |
| First diverge stage | ending-number / bracket extraction (text-only gate) |
| Benchmark source-faithful? | **Yes** — PDF matches truth |

**Classification:** `1. bracket not detected` (text path only; ink bracket present) + `2. bracket detected but label missing` from pipeline POV (no raster label path). Source-faithful production defect.

### Measure 8 — second ending

| Field | Observation |
|-------|-------------|
| Page / system / staff | 1 / 1 / treble+bass grand |
| Measure numbers | 8 |
| Printed repeat barlines | Backward at end of m8 |
| Printed ending bracket | Yes — horizontal above staff |
| Bracket start (approx px) | x≈713–717, y≈672 |
| Bracket end (approx px) | near final barline x≈933 |
| Horizontal span | ~full measure (~220 px), dens≈0.855 |
| Vertical stroke at start | Yes (~13 px; inset ~4–6 px from measure x0) |
| Vertical stroke at end | Present at final barline / with repeat |
| Ending label text | `2.` |
| Label provenance | Raster ink only |
| Measures under bracket | 8 only |
| Expected MusicXML | `ending number="2" type="start"` + `stop` + backward repeat |
| Generated | backward only |
| Repeat direction | backward — already recovered |
| First diverge stage | same text-only volta gate |
| Benchmark source-faithful? | **Yes** |

**Classification:** same shared mechanism as m7 — production defect, not benchmark truth.

### Non-ending measures 5–6 (controls)

No horizontal volta-density rows in the above-staff band; no hooks. Correct negative evidence.

## Pipeline trace (current)

```
PDF raster (empty text)
→ staff/system/barlines OK
→ repeat dots/barlines OK (m1 forward, m8 backward)
→ detectVoltaEnding → detectVoltaFromText only → null
→ endingMarking null on m7/m8
→ MusicXML: no <ending>
→ evaluator volta-mismatch ×2
```

Documented code comment in `detectOmrRepeatBarline.js`: ink-only digit heuristics intentionally disabled as too weak / FP-prone. Scan PDFs with empty text layers therefore never emit endings even when brackets+labels are printed.

## Support matrix (before fix)

| Capability | Status |
|------------|--------|
| First / second endings (vector+PDF text) | Supported |
| Multiple ending numbers | Text path: single digit `N.` |
| stop vs discontinue | stop via hook / `finalizeEndingStops` |
| Multi-measure span | finalize closes when next start differs |
| Cross-system continuation | not evidenced here |
| Bracket without right vertical | stop via finalize |
| Scan raster brackets + `1.`/`2.` | **Unsupported** |
| Broad page OCR | Not used (correct) |

## Decision

Both mismatches are **source-supported production defects** with one shared root cause: volta detection requires PDF text labels; scan has brackets+`1.`/`2.` in raster only.

**Do not classify as benchmark truth.** Proceed to Phase 3–6: joint bracket + conservative local digit classification + existing stop finalization / MusicXML emission.
