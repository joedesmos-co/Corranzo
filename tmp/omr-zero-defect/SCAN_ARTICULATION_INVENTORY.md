# Scan Articulation Inventory

**Fixture:** `piano-articulation-scan`  
**HEAD at inventory:** `5252f36` (validated continuation of `33ee7f3`)  
**Generated:** 2026-08-05  
**Raw data:** `tmp/omr-zero-defect/scan-artic-inventory/inventory-raw.json`  
**Crops:** `tmp/omr-zero-defect/scan-artic-inventory/crops/`

## Scope

Inventory only — **no production code changes** in this phase.

Legacy detector at HEAD: `detectStaccatoOnNote` (5×5 ink-count above/below each head).  
**No raster accent path exists.**

## Corpus vs inventory counting

| Source | Staccato | Accent |
| --- | ---: | ---: |
| Truth MusicXML | 12 | 12 |
| Generated MusicXML | 61 | 0 |
| Official corpus codes | missing-staccato ×49 | missing-accent ×12 |
| Inventory mismatch rows | missing-staccato ×8 | missing-accent ×4 |

Official corpus counts chord-tone / unexpected interactions more aggressively than the compact inventory rows. Both agree on the mechanism: **many false staccatos, zero accents**.

## Truth articulation map (source MusicXML)

All articulations are on **staff 1 (treble), voice 1, beat-1 chord tones** (3 notes each):

| Measure | Expected | Chord (labels) |
| --- | --- | --- |
| 1 | staccato ×3 | C4 E4 G4 |
| 2 | accent ×3 | D4 F♯4 A4 |
| 3 | staccato ×3 | E4 G♯4 B4 |
| 4 | accent ×3 | F4 A4 C5 |
| 5 | staccato ×3 | G4 B4 D5 |
| 6 | accent ×3 | A4 C♯5 E5 |
| 7 | staccato ×3 | G4 B4 D5 |
| 8 | accent ×3 | E4 G♯4 B4 |

No tenuto/marcato in truth. Bass staff has **no** articulations.

## PDF visual classification (beat-1 treble crops)

| Measure | PDF mark | Placement | Noise in crop |
| --- | --- | --- | --- |
| 1 | Compact staccato dot | In-staff space above chord | Staff lines; accidental wedges left of heads |
| 2 | Accent chevron `>` | Between staff lines above chord | Slur arc above; measure number; staff lines |
| 3 | Staccato dot | In-staff above chord | Staff / stem |
| 4 | Accent chevron | Above staff near fingering “4” | Digit, barline, staff |
| 5–8 | Alternating staccato / accent | Same pattern, system 2 | Volta (m7–m8), slur fragments |

## Beat-1 treble pipeline ownership (HEAD)

| Measure | Expected | Generated on beat-1 treble nodes | First failing stage |
| --- | --- | --- | --- |
| 1 | staccato | staccato | matched (legacy ink probe) |
| 2 | accent | **staccato** | **misclassified** — no accent classifier; wedge ink satisfies 5×5 staccato band |
| 3 | staccato | staccato | matched |
| 4 | accent | **staccato** | misclassified (same) |
| 5 | staccato | staccato | matched |
| 6 | accent | **staccato** | misclassified |
| 7 | staccato | staccato | matched |
| 8 | accent | **staccato** | misclassified |

## False positives (non beat-1 / bass)

- **41** generated articulations on nodes that are not treble beat-1.
- Mechanism: per-note 5×5 probe fires on staff-line crumbs, stem fragments, ledger dots, accidental ink.
- Class: `staff/ledger/stem noise mistaken for staccato`.

## Separated categories

| Category | Count / status |
| --- | --- |
| True staccato (PDF+truth) | 4 measures × 3 tones = 12 |
| True accent (PDF+truth) | 4 measures × 3 tones = 12 |
| Tenuto / marcato | unsupported in this fixture |
| Augmentation dot as staccato | not primary on beat-1; possible contributor to mid-measure FPs |
| Accent mistaken as staccato | **all 4 accent measures** |
| Staff/ledger noise as staccato | majority of 61−12 ≈ 49 extras |
| Stem/beam fragment | contributor to FPs |
| Slur/tie fragment as accent | slur present m2/m3; not currently classified as accent (accent path absent) |
| Accidental as articulation | left-of-head sharp ink visible in crops; risk for local probes |
| Text/dynamic / fingering | m4 “4” near accent — must not become articulation |
| Benchmark inconsistency | none for articulations themselves (marks are printed) |
| Unsupported / ambiguous | none for beat-1 marks — visually clear |

## First-stage loss / invention map

1. **Accent loss:** never extracted — raster pipeline only calls `detectStaccatoOnNote`.
2. **Accent→staccato invention:** wedge pixels land in the fixed ±8px / 5×5 window → false staccato.
3. **Staccato FP invention:** same probe on every head without staff/stem masking or chord-level ownership.
4. **Rejected prior approaches:** global morphology / joint column CC with wide staff corridors (Articulation 17%→≤10%).

## Required next architecture (Phase B)

**Note-anchored local patch classification** (not global instance extraction):

- Crop in staff-spaces above/below known chord extent.
- Mask staff lines, notehead bodies, stems when known.
- Classify compact dots vs wedges vs short tenutos with abstain.
- One mark per onset column; broadcast per existing MusicXML chord semantics.
- Do not attach across staves/measures by proximity alone.

## Acceptance metrics for later fix

- Scan Articulation ↑ from **16–17%** with fewer missing-accent and fewer unexpected staccatos.
- Preserve 88/88 notes, Pitch 100%, Measure Structure 100% on scan.
- Guitar/TAB unchanged; vector articulations unchanged.
