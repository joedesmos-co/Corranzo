# Guitar Dataset v2 — Collection Report (pilot: machinery proven, CASE B)

**Manifest:** `datasets/guitar-vision/v2-pilot/dataset-manifest.json`
**Pipeline:** `dataset-ingest.mjs` → `dataset-render.py` → `dataset-finalize.mjs`
**Scale label:** PILOT. 12 real scores prove the machinery end to end; the
150-score freeze happens after acquisition. Nothing here claims Dataset v2.

## D-RETURN

1. **Candidate score count:** 19 (14 real-printed + 5 synthetic-validation).
2. **PASS score count:** 17 (12 real + 5 synthetic-validation tier).
3. **Quarantine count/reasons:** 2 — `bwv999`, `aguado-a-minor-study`, both
   `QUARANTINED:playability` (systematic barline/content misalignment from
   MIDI-derived conversion: every-measure union overflow, e.g. 4.25q vs 3.0q;
   documented, not repaired). 8 more PASS scores carry 1–4 flagged measures
   each (≤1/32-note converter overhangs; explicit in truth, tolerated by rate).
4. **Licensing summary:** real tier CC BY-SA 4.0 (Mutopia, per-file `<rights>`
   evidence mined into `licenseEvidence`) — commercial-use OK with
   attribution; synthetic tier CC0-1.0; quarantined-by-license (not ingested):
   musicxml.com examples (display permission only), classtab archive (no
   license statement), GOAT (gated Zenodo access), scraping targets (ToS).
5. **Standard/TAB/paired distribution (real):** 11 standard-only / 0 tab-only
   / 1 paired. TAB thirds are a DATA_GAP (see 16).
6. **Exact source→render join rate:** 1.0 on all 17 (joins 32–1091 per score,
   multi-page included, rests included, zero order fallback).
7. **Playable-event validation:** 258/258 pairing-verified under structured
   capo 4 + alternate tuning on the validation piece (BrookeWest, quarantined
   by license, used for validation only); pilot real scores have no TAB
   positions to verify (standard-only); 2 misaligned scores quarantined.
8. **Notation coverage matrix:** 17/115 families observed in real data
   (durations, dots, tuplets, ties, voices, chords, accidentals, keys…);
   full table in manifest `coverage`.
9. **Technique coverage (real):** 0 techniques. All 16 D5 technique families
   are DATA_GAPs at COMMON/UNCOMMON tiers (schema-verified by fixtures, absent
   from the MIDI-derived classical studies).
10. **Scale/glyph-size distribution:** pilot renders are single-engraver
    (Verovio) + music21-derived layouts; native scale diversity NOT yet
    demonstrated — DATA_GAP by construction until multi-engraver scores arrive.
11. **Quality metadata summary:** per-page vector + 1050/2100px raster
    (contrast, blur variance, ink coverage, dimensions) on all 17; schema
    shared with the future scan/photo path (`REALWORLD_EVAL.md`).
12. **Duplicate/leakage findings:** 1 real duplicate group found by content
    digest (synthetic vector/scan pair — same tier, no split crossing, proves
    D11 works); cross-split collisions: 0; splits audit: role coverage FAILS
    at pilot scale (validation has no risk collection — gate working as designed).
13. **Frozen TRAIN/DEV/TEST counts:** pilot 8/3/1 over 12 real scores
    (collection-grouped, digest-frozen; ratios scaled to pilot, not the 150 plan).
14. **Target-label counts:** objects 5220, rhythm 5220, pitch 4309, voice 5220;
    string/fret 28, pairing 28, technique 0, articulation 0 (per-split table
    in manifest). TAB/technique heads have no real supervision yet.
15. **Zero-parameter sanity:** 55/64 (8 strict-timing flags on converter
    overhangs + 1 split-role scale artifact; joins/bboxes/relations/pairing/
    quality/duplicates all pass).
16. **Remaining DATA_GAP families:** 29, incl. every D5 technique, TAB thirds,
    capo/positions/frames/navigation/grace-cue in real data, scale diversity.
17. **Real-world evaluation:** protocol + vector/raster tiny sample committed;
    scan/photo rig specified, not built.
18. **CASE B — DATA GAPS.** Training authorization stays blocked.
19. **Model training is NOT authorized.**
20. **Next step if this were CASE A:** not applicable. Actual next step is the
    acquisition shopping list below.

## Acquisition shopping list (prioritized, license-first)

1. **GOAT access request** (Zenodo, CC-BY 4.0): 172 TAB-annotated performance
   items with techniques → needs `.gp`→MusicXML converter validation + notation
   rendering decisions documented before ingestion.
2. **Classtab license clearance**: ~4000 classical TABs + 2000 MIDIs, but no
   license statement → contact owner or quarantine stands; would fill TAB +
   technique thirds for public-domain works.
3. **Mutopia `.ly` converter**: ~372 guitar pieces (standard notation) → needs
   LilyPond-subset→MusicXML converter verified against Mutopia MIDIs; fills
   the standard third with real engraving diversity.
4. **Commissioned original etudes** (clean ownership): targeted technique
   coverage (bends, harmonics, tapping, palm-mute, capo positions) with
   professional engraving in 2–3 tools.
5. **Multi-engraver requirement**: no two thirds from one exporter; Verovio
   renders are determinants, not diversity.

## Known limitations found during collection

- **Cross-part pairing**: BrookeWest keeps notation and TAB in separate PARTS
  (not staves); mirror reconciliation is staff-scoped, so no `pairings[]`
  links form (per-event pitch verification still holds: 258/258). Part-level
  pairing is future work.
- **Legacy corpus tension**: 2 scores quarantined here remain in the frozen
  historical splits (untouched by design). Dataset v2 intake is strictly
  tighter than the legacy fret corpus — the gate working, not a contradiction.
- **Structured `<capo>` discovery**: MusicXML DOES define `staff-details/capo`
  (prior "no capo element" claim corrected; parser + vocabulary updated).
  Text-mined capo remains the fallback with confidence tags.
