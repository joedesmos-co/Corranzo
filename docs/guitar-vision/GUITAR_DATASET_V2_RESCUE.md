# Guitar Dataset v2 — Acquisition Rescue Report (A0–A13)

**Manifest:** `datasets/guitar-vision/v2/dataset-manifest.json` (v2; the
`v2-pilot` manifest is preserved untouched as historical evidence)
**Pipeline:** `dataset-ingest.mjs` → `dataset-render.py` (3 layouts) →
`dataset-finalize.mjs`
**Etudes:** `datasets/guitar-vision/etudes/` (33 original, CC0,
`corranzo-original-etudes-v1`, tier `controlled-original`)

## A-RETURN

1. **PDMX guitar inventory:** 0 accessible. The PDMX archives (PDMX.csv,
   mxl.tar.gz, pdf.tar.gz, subset_paths.tar.gz) do not exist on this machine
   (all documented paths checked, plus repo-wide and tmp sweeps); no download
   source is documented in the factory; disk has 7.9 GiB free against the
   factory's own 20 GiB floor. Only factory code + run metadata exist. The
   `no_license_conflict`/`all_valid` filter definitions were reviewed for
   reuse when archives appear. PDMX is recorded as pending, not used.
2. **Usable standard/TAB/paired counts (real):** 11 standard-only / 0
   TAB-only / 1 paired. Plus etudes: 32 standard / 0 tab-only / 1 paired.
3. **License audit:** real CC BY-SA 4.0 (Mutopia per-file `<rights>`);
   etudes CC0-1.0 original; synthetic CC0-1.0. Quarantined: musicxml.com
   examples (display-only permission), classtab (no license statement),
   GOAT (Zenodo gated + research-only per A4 — excluded even if accessed),
   scraping (ToS). BrookeWest used validation-only, never committed.
4. **Pilot PASS/quarantine:** v2 ingest 50/52 (12 real + 33 etudes + 5
   synthetic-validation PASS; bwv999 + a-minor-study quarantined on
   systematic converter misalignment). Render joins 1.0 on every PASS score
   × 3 layouts.
5. **Cross-part pairing findings:** implemented (`pairCrossPartTab`, scope
   `cross-part`, tuning-aware incl. alternate tunings) with 4 fixtures
   (basic, chord, ambiguous-duplicates→quarantine, drop-D). PDMX structure
   mix unmeasurable (no archives); BrookeWest-style separate-part layout is
   handled and proven. Cross-part copies are exempt from same-string
   conflicts (same finger, not a second one).
6. **Real technique distribution:** 0 techniques in 12 real scores (MIDI-
   derived classical studies). Etudes contribute 103 technique instances /
   76 parameters across 14 families (bend×5 etudes, slide, legato, harmonics,
   tapping, palm-mute, let-ring, golpe, vibrato, tremolo, arpeggio, trill).
7. **Original-etude requirements:** covered by 33 etudes in 25 technique
   groups (split-grouped so techniques spread across splits). Remaining
   supervised-but-thin: pinch-harmonic (source-limited), rasgueado
   (ambiguous), whammy (source-limited) — correctly absent by schema design,
   not by omission.
8. **Additional sources investigated:** GOAT (gated + research-only),
   GuitarSet (audio/JAMS, no engraving), mutopia MIDI tokens (no notation),
   classtab (gray), TuxGuitar (gray), Wikifonia (weak + gray), HF audio sets
   (wrong modality), musicxml.com examples (display-only).
9. **Combined real-score total:** 12 (+ 2 quarantined with reasons).
10. **Combined controlled-original total:** 33.
11. **Notation-family coverage:** 66 families (17 real + etude-only);
    per-family real/etude/split counts in manifest `coverage`.
12. **Source/render joins:** 1.0 identity on all 50 PASS × 3 layouts
    (standard/compact/large page geometry), multi-page and rests included,
    structure-key determinism proven (Verovio random-id canonicalization
    documented in the render script).
13. **Source timing validation:** union-of-spans semantics (sustained bass is
    sustain, not corruption); 8 real scores carry 1–6 masked micro-measures
    each (≤1/32-note converter overhangs); masks recorded per score,
    excluded from rhythm/voice supervision (251 masked events), kept in truth.
14. **Scale/layout diversity:** 3 deterministic layout passes per score
    (genuine line-break/staff-size/spacing variation, not reshrinks);
    notehead heights span 26–561 page units; TAB digit scale has exactly one
    observed size (thin TAB content — honest DATA_GAP, not a rendering gap).
15. **Duplicate/leakage:** 1 real duplicate group (synthetic vector/scan pair,
    same tier, no split crossing); cross-split collisions 0; splits audit
    CLEAN (23 train / 11 validation / 9 heldout / 2 diagnostic, digest-frozen).
16. **Final split status:** v2 manifest frozen with seed+digest; pilot splits
    preserved; 20-score fret benchmark untouched and excluded.
17. **Remaining DATA_GAPs:** 29 real-coverage gaps (all techniques, TAB
    thirds, capo/frames/navigation/grace in real data, scale diversity);
    24/29 have etude supervision (listed per gap with rescuing etudes).
18. **CASE B — DATA GAPS.** Real TAB representation and technique breadth
    still require external acquisition (GOAT access, classtab clearance,
    Mutopia converter, commissions per the collection report).
19. **Training NOT authorized.**
20. **Exact next step:** pursue the acquisition shopping list (collection
    report) while training LOCAL heads only if/when a CASE-A freeze lands;
    meanwhile the etude tier supports technique-head development with
    abstention on real data.

## What changed since the pilot (this task)

- PDMX investigated and ruled out (evidence above), not assumed.
- Cross-part TAB pairing implemented, tested, and proven on 4 fixtures.
- Union rhythm semantics; per-measure A9 masks with consistency checks.
- Shared `verifyPairing` (truth and playability cannot disagree) incl.
    harmonic series physics + artificial triple arbitration.
- Structured `<capo>` discovery (staff-details) outranking text mining.
- Declared (non-TAB) tunings surfaced without touching TAB-gated behavior.
- 33 original etudes composed, validated clean (0 quarantines), ingested,
    rendered ×3 layouts, split by technique group.
- v2 manifest (12 real + 33 etudes + 5 synthetic-validation) with tier-
    separated quotas, targets, sanity (311/319; 8 strict-timing flags are
    the documented masked measures), and multi-layout quality metadata.
