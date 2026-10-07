# Piano Vision verified dataset pilot — report

Worktree: `/Users/ryland/Documents/scoreflow-piano-unblock`
Branch: `codex/piano-truth-unblock`
Base: `a4f21e2a62` (CASE A truth-unblock closure)
This task is data engineering. **No model training, no RTX, no MPS.**

---

## 1. Summary

A 1,000-score piano pilot was selected deterministically from the commercially
clean PDMX subset, rendered with the proven instrumented Verovio pipeline, and
verified at the element level. 990/1,000 scores PASS (99.0%); 10 are
quarantined with explicit reasons. The passing set contains **170,623 notes and
242,358 machine-readable objects**, all with exact source/render correspondence,
source-identity verification, canonical hashes and frozen score-level splits.
The OLiMPiC scanned harness is ingested and plumbed (2,931 real-scan system
crops, self-check distance 0.0). The zero-parameter sanity baseline passes.

## 2. P0 — proof verification before scaling

The 11-score provenance proof was re-run as a hard gate. Three provenance
defects were found and fixed before scaling:

1. `getMEI()` embeds an `isodate` timestamp → provenance hashes now use
   **canonical MEI**; two consecutive full proof runs are byte-identical
   (`out/summary.json` sha256 `813012f8…`).
2. The staff-line extractor filtered vertical paths (staff lines are
   horizontal), so the visual-staff check had silently compared zero notes and
   reported a vacuous "100% agreement". Corrected: **9,253/9,534 (97.05%)**
   agree; the 281 disagreements are ledger-line/between-staff/octave-shift
   placements where the geometric heuristic is ambiguous. Source staff ancestry
   is exact and unaffected.
3. Bounding-box attribute parsing let `stroke-width` overwrite `width`, so all
   recorded bbox widths were 0. Fixed in both the proof and the production
   pipeline.

All 9,534 note joins, all state joins and cross-process determinism reproduce.
`p0_parity.py` confirms the production module (`pv_pipeline.py`) matches the
proof on all 11 scores (notes, id join, state join, identity).

## 3. P1 — selection

- Filter: instrument set **piano-only**, `subset:no_license_conflict = True`,
  `subset:all_valid = True`, MXL present.
- Eligible candidates: **182,444**.
- Selection: `sha256(seed|source_path)` ascending, first 1,000; seed 20261007.
- Selection manifest: `manifests/selection.json`, sha256
  `e5ce0c995828fcee1e23eb0ed1c617de004d651d4d307ed6ad8a7d2120360304`.
- MXL fetch: 1,000/1,000 extracted from the official PDMX archive; per-file
  sha256 in `manifests/mxl_fetch.json`.

## 4. P2/P3 — render and exact join

Pinned pipeline: Verovio 6.3.0, `xmlIdSeed = 20261007`, SVG bounding boxes on,
canonical MEI hashing.

| quantity | value |
|---|---|
| scores rendered | 1,000/1,000 (100%) |
| PASS | **990 (99.0%)** |
| pages rendered | 1,141 |
| notes (PASS set) | **170,623** |
| notes id-joined | **170,623 / 170,623 (100%)** |
| objects (PASS set) | 242,358 |
| source-identity check (music21 population, octave-shift aware) | **990/990 exact** |
| state groups rendered | 14,157 |
| state groups resolved | 14,028 (99.09%); 0 mismatches; 129 unresolved (0.91%) |
| unrendered measure rests | 0 |
| invalid geometry | 0 |

Every passing score records: source hash, canonical MEI hash, SVG hash, object
hash, page geometry, join statistics, coverage classes and split identity in
`manifests/dataset_pilot-v0.manifest.json`.

## 5. P4 — quarantine

10 scores quarantined, never dropped silently:

| reason | scores |
|---|---|
| unsupported articulation (`scoop` / `doit` / `fall`; imported to MEI, not rendered) | 6 |
| source identity unverifiable (music21 cannot parse the export) | 2 |
| broken id join (4 unrendered arpeggio elements) | 1 |
| ambiguous state join (1 clef placement) | 1 |

All 10 remain in the manifest with their status and full diagnostics.

## 6. P5 — manifest

`manifests/dataset_pilot-v0.manifest.json` + `.sha256`, schema
`corranzo.piano.pilot.dataset/1`, content-addressed by source + renderer + seed
+ pipeline hash. Append-only policy: a new dataset version gets a new file; the
v0 file is never edited. The dataset is reproducible from the selection/fetch
manifests + the pinned renderer.

## 7. P6 — frozen splits

Score-level, deterministic from seed 20261007, disjoint and covering the PASS
set: **train 792 / dev 99 / test 99**. `manifests/splits.json` + `.sha256`.
No page or measure from one source can cross splits. TEST is not used for any
pipeline tuning.

## 8. P7 — coverage

Full matrix in `reports/COVERAGE.md`. Highlights: notes 170,623 (100% mapped),
beams 34,247, articulations 4,761, ties 3,530, slurs 2,971, accidentals 6,343,
pedal 1,152, grace 1,045, tuplets 1,330, octave shifts 89 elements / 3,545
shifted notes, fingerings 168, dynamics 654, hairpins 248, endings 309,
harmony 2,843, trills 239, arpeggios 178. All classes mapped at 1.0000.
Rare/unsupported classes are called out explicitly (scoop/doit/fall
articulations; 129 unresolved state glyphs; single-tremolo encodings are
encoding-dependent).

## 9. P8 — real-world benchmark harness

OLiMPiC 1.0 Scanned (CC BY-SA 4.0) ingested: **2,931 system crops** (1,493 test
+ 1,438 dev) with PNG + MusicXML + LMX truth and per-file hashes. Evaluation
plumbing is normalised LMX edit distance; the self-check (truth-as-prediction)
scores 0.0 on all 2,931 samples, and an empty prediction scores 1.0. Details in
`reports/OLIMPIC_HARNESS.md`. No training and no tuning on this benchmark.

## 10. P9 — controlled capture specification

`reports/CAPTURE_PROTOCOL.md` defines device/angle/lighting/blur/compression/
crop ranges, registration to source truth, acceptance thresholds, and the rule
that truth stays pre-capture with the transform recorded. No captures were made
in this pilot.

## 11. P10 — zero-parameter sanity baseline

See `reports/BASELINE.md` and `manifests/baseline.json`: **verdict PASS**. All
checks green — splits disjoint/covering, 0 missing hashes, 0 id-join misses,
14,028/14,157 state groups resolved with 0 mismatches, 990/990 identity-exact,
0 geometry-invalid notes, 30/30 object-table sample hashes, 20/20 raster sample,
25/25 cross-process determinism. No learning is involved.

## 12. P11 — quality-gate foundation

Per-page metadata written to `data/quality/`: raster dimensions, staff gap in
units/page/raster pixels, contrast, blur (Laplacian variance), ink fraction.
These are the measurable inputs a future quality gate will use; no quality
model was trained.

## 13. P12 — dashboard pair ingestion

`scripts/p12_pair_ingest.py` implements the PDF + MusicXML/MXL pair contract
(source hash, identity check, re-render, join, dropped-feature check, PDF
probe + first-page raster, status). Tested on 9 real in-repo pairs: **9 PASS,
0 quarantined**. Schema example: `manifests/pairs_batch_example.json`; details
in `reports/PAIR_INGEST.md`.

## 14. P13 — resources

CPU only (10 cores); 3 render workers; no GPU/MPS. Disk: ~3.3 GB of working
data (2.2 GB PDMX archives, 335 MB OLiMPiC, ~0.6–1 GB renders/objects), inside
the 26 GB available. Committed artifacts are code, manifests and reports only;
raw data is gitignored and reproducible from the manifests.

## 15. P14 — success gate

| criterion | result |
|---|---|
| high successful render rate | 100% loaded, 99.0% PASS |
| high exact join rate | 100% notes; 99.09% state resolved, 0 mismatches |
| deterministic provenance | 25/25 cross-process identical; canonical hashes |
| meaningful notation coverage | 30+ classes, all 1.0000 mapped; rare classes called out |
| clean frozen splits | 792/99/99 score-level, disjoint, hashed |
| benchmark harness exists | OLiMPiC scanned ingested + self-checked |
| no hidden source-identity ambiguity | 990/990 identity-exact; quarantines explicit |

**Gate: PASSED at pilot scale.**

## 16. Answers to the required return items

1. **Selected PDMX count**: 1,000 (from 182,444 eligible; piano-only,
   no_license_conflict, all_valid).
2. **Rendered count/rate**: 1,000/1,000 loaded; 990 PASS (99.0%).
3. **Quarantined**: 10 — 6 unsupported articulation, 2 unparseable source, 1
   unrendered arpeggio, 1 state placement.
4. **Exact note join**: 170,623/170,623 (100%).
5. **Non-note join coverage**: all classes 100% mapped; state 14,028/14,157
   resolved, 129 explicitly unresolved, 0 mismatched.
6. **Notation coverage matrix**: `reports/COVERAGE.md`.
7. **Deterministic rendering**: 25/25 cross-process identical (canonical MEI,
   SVG, objects); seed pinned for the full run.
8. **Manifest format**: content-addressed JSON with per-score source/render/
   objects hashes, joins, coverage, page geometry, quarantine, split.
9. **Frozen splits**: train 792 / dev 99 / test 99.
10. **Real-world harness**: OLiMPiC scanned ingested (2,931 samples),
    self-check 0.0; prediction mode ready.
11. **Capture specification**: `reports/CAPTURE_PROTOCOL.md`.
12. **Zero-parameter sanity**: `reports/BASELINE.md` — PASS.
13. **Remaining unsupported notation**: scoop/doit/fall articulations;
    encoding-dependent single tremolos; repeat navigation semantics; 129
    unresolved state glyphs; note-level real-world images (capture route).
14. **Licensing/provenance**: PDMX CC BY 4.0, `no_license_conflict` subset,
    underlying PD/CC0; OLiMPiC CC BY-SA 4.0 (review advised); all hashes and
    sources recorded.
15. **Storage size**: ~3.3 GB working data; committed artifacts are small
    (code + manifests + reports).
16. **Runtime/resources**: selection ~2 min (cached metadata), fetch ~1 min,
    render ~2.5 min for 1,000 scores (3 CPU workers), determinism ~1 min,
    rasterisation 1,141 pages single-threaded (~35 min), quality ~1 min.
    CPU only, no GPU/MPS.
17. **Is dataset v0 scientifically trustworthy?** Yes, within the stated
    limits: exact source identity and element joins on all PASS scores,
    deterministic canonical provenance, explicit quarantines and unresolved
    counts, frozen splits, and an independent real-scan benchmark. Real-world
    note-level acceptance still requires the capture route.
18. **Is Piano model training NOW justified?** The P14 gate is passed, so
    training is scientifically justified as the next phase. It was not
    performed in this task. The recommended first training run uses the frozen
    train/dev splits with OLiMPiC test as the external acceptance benchmark,
    leaving the pilot TEST split untouched until final acceptance.
19. **Exact next step**: freeze v0 (done), then run a small supervised
    training/adaptation experiment against `train` with `dev` model selection
    and OLiMPiC test as the real-world acceptance gate; in parallel, start the
    controlled capture set for note-level real-world truth.

## 17. Artifacts

| artifact | path |
|---|---|
| selection manifest | `manifests/selection.json` (+sha256) |
| MXL fetch manifest | `manifests/mxl_fetch.json` (+sha256) |
| dataset v0 manifest | `manifests/dataset_pilot-v0.manifest.json` (+sha256) |
| splits | `manifests/splits.json` (+sha256) |
| coverage | `manifests/coverage.json`, `reports/COVERAGE.md` |
| determinism | `manifests/determinism.json` |
| baseline | `manifests/baseline.json`, `reports/BASELINE.md` |
| OLiMPiC benchmark | `manifests/olimpic_benchmark.json` (+sha256) |
| OLiMPiC self-check | `manifests/olimpic_selfcheck.json` |
| pair ingest example | `manifests/pairs_batch_example.json` |
| reports | `reports/PILOT_REPORT.md`, `COVERAGE.md`, `BASELINE.md`, `OLIMPIC_HARNESS.md`, `CAPTURE_PROTOCOL.md`, `PAIR_INGEST.md` |
| scripts | `scripts/p0_parity.py`, `p1_select.py`, `p1_fetch_mxl.py`, `pv_pipeline.py`, `p2_render.py`, `p2_raster.cjs`, `p2_make_worklist.py`, `p2_determinism.py`, `p5_manifest.py`, `p6_splits.py`, `p7_coverage.py`, `p8_olimpic_harness.py`, `p10_baseline.py`, `p11_quality.py`, `p12_pair_ingest.py` |
