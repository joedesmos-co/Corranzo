# Piano Vision truth-unblock — reopen decision

## DECISION: CASE A — NEW TRUTH ROUTE FOUND

A new data/source approach provides materially better independent truth and
satisfies the formal reopen conditions.

---

## 1. Previous blocker summary

Independent Piano source-truth certification was **BLOCKED** because
Corpus 2.1 / PDF / MusicXML did not contain enough independently recoverable
correspondence to certify a clean truth population (N=12 noteheads vs required
≥50; clean gate NOT_EVALUATED). Eleven automated routes bottomed out on missing
information: raster geometry cannot localise noteheads in dense piano notation
(precision ~0.22), blind AI review will not certify confidence, and pitch-blind
DP alignment has no discrimination on real dense measures (median margin 0.32
vs 7.4 on determined synthetic cases). The blocker was informational, not
architectural. Nothing was proven about the labels being wrong or the gate
failing.

## 2. Datasets/sources investigated

PDMX, OpenScore Lieder, Mutopia, GrandStaff, MSMD, PrIMuS/Camera-PrIMuS,
DeepScoresV2, DoReMi, MUSCIMA++/CVC-MUSCIMA, HOMUS, SMB, OLiMPiC (synthetic and
scanned), ASAP, IMSLP, and controlled captures. Full table and scores in
`DATASET_MATRIX.md`.

## 3. Licence/commercial findings

Commercially usable: PDMX (CC BY 4.0 dataset, underlying PD/CC0, use
`no_license_conflict`), OpenScore Lieder (CC0), Mutopia (CC BY / BY-SA / PD),
MSMD (CC BY 4.0), DeepScoresV2 (CC BY 4.0), GrandStaff (MIT packaging;
GrandStaff-LMX CC BY-SA 4.0), OLiMPiC (CC BY-SA 4.0, legal review advised for
adapted-data redistribution). Excluded: MUSCIMA++/CVC-MUSICMA, ASAP, SMB
(non-commercial), PrIMuS/DoReMi/HOMUS (no clear licence). Details in
`RESEARCH.md` §2.4.

## 4. Best candidate

**Self-rendered symbolic truth**: MusicXML/MXL → deterministic Verovio render
with pinned `xmlIdSeed` → MEI ids + SVG element ids + official bounding boxes →
exact element table. Backing corpus: PDMX (192,777 piano-including
no_license_conflict + all_valid scores; 182,464 piano-only), with OpenScore,
Mutopia, GrandStaff, MSMD as additional commercially clean sources. Real-world
evaluation: OLiMPiC scanned systems and controlled Corranzo captures.

## 5. Why it actually changes available information

The old campaign had to *recover* correspondence between a PDF and a MusicXML
of uncertain relation from pixels. The new route **declares** correspondence by
construction: the symbolic source is the render input, and the renderer exposes
element ids and geometry that can be machine-verified. The information the old
campaign lacked — independent note identity — is now present and checkable.
Additionally, PDMX supplies same-source PDF+MXL pairs (source identity exact by
documentation) at ~192k piano scale, which removes the population-identity
problem even without element mapping. This satisfies condition **C** (a
genuinely stronger correspondence method) and materially satisfies condition
**A** (substantially more complete PDF↔source correspondence).

## 6. Symbolic→rendered correspondence findings

Proven in `proof/REPORT.md` (11 scores, CPU-only, no training):

- **9,534/9,534 notes id-joined** (SVG id = MEI id), including chords,
  multi-voice, grace and cue notes.
- All non-state event classes id-joined 100%: rests 728, mRest 29,
  accidentals 1,590, beams 1,317, articulations 2,335, ties 156, slurs 110,
  tuplets 113, dynamics 143, hairpins 75, tempo 318, pedal 238, octave 40,
  arpeggios 70, ornaments 7, glissando 1, fingering 1, fermatas 6, rehearsal 1,
  directions 21, endings 2.
- clef/keySig/meterSig have no id link (layout-generated ids); the semantic
  state join resolved **641/641** rendered groups (612 exact, 4 courtesy at
  system ends, 25 within-measure/previous-state).
- **9,253/9,534** notes (97.05%) are geometrically nearest to the staff the
  source assigns; the 281 disagreements are ledger-line/between-staff and
  octave-shift placements where the geometric heuristic is ambiguous. Source
  staff ancestry itself is exact; a probe cross-staff note joins correctly.
- Byte-identical renders across processes with a pinned seed (11/11).
- music21 cross-check exact on 9/11; the two differences are fully explained by
  octave-shift pitch semantics.

## 7. Notation coverage

The full target vocabulary is covered by the source and renderer except:
tremolo (dropped by the MusicXML importer; needs an MEI-input path), and
repeat/navigation semantics (source-level, not glyph-level). Octave shifts,
grace/cue notes, pedal, arpeggios, glissandi, ornaments, fingerings, fermatas,
dynamics, hairpins, rehearsal marks, tempo, multi-voice and cross-staff all
verified. Coverage table in `RESEARCH.md` §6.

## 8. Domain-gap analysis

A render-transform-paired generator: geometric transforms (scale, rotation,
skew, perspective, crop, smooth warps) are recorded as matrices/fields and
applied to labels exactly; photometric transforms (blur, JPEG, illumination,
noise, paper/print simulation) leave labels invariant and are recorded with
seeds. Truth is always the pre-transform symbolic identity. Detail in
`RESEARCH.md` §4.

## 9. Real-world evaluation strategy

Primary: OLiMPiC scanned dev/test (real IMSLP scans, system-level LMX truth,
CC BY-SA) evaluated with an edit-distance metric. Secondary: controlled
Corranzo print/scan/photo captures with exact truth and verified registration.
Tertiary: PDMX/OpenScore same-source PDFs for whole-score engraving realism.
SMB is research-only (NC). Detail in `RESEARCH.md` §5.

## 10. Training/adaptation compatibility

Pair records carry source hash, licence, renderer version, seed, render hash,
transform recipe, quality verdict, join report and split; source identity is
re-verified by re-render; splits are by source score/composer/collection;
manifests are content-addressed and append-only; a 10-PDF+MXL upload batch
becomes 10 source hashes with verification reports. Detail in `RESEARCH.md` §8.

## 11. Small proof results

Executed and passed (see `proof/REPORT.md`): 11 symbolic scores, 9,534 notes,
exact element/state joins, corrected staff-geometry check (97.05%, ambiguity
characterised), cross-process
determinism, rasterisation to ~300 DPI, plus a controlled coverage probe. The
proof also produced five falsification findings (state-element ids, rest
normalisation edge case, tremolo drop, octave-shift pitch semantics,
determinism opt-in), all characterised with workarounds.

## 12. Hostile/falsification findings

Summarised in §11 and `RESEARCH.md` §9. The route survived: no source ids are
lost for notes/events; layout is deterministic and exact; grace/cue/cross-staff
ownership is preserved; licences are usable; the only real limits are tremolo
labelling and the synthetic visual domain (a transfer question, not a truth
question).

## 13. Remaining uncertainties

1. PDMX same-source PDF↔MXL pairing is the dataset authors' documentation, not
   independently verified here (needs the large tarballs). The self-render
   route does not depend on it.
2. Verovio import/join failure rate at PDMX scale is unmeasured; the pilot must
   quantify and quarantine.
3. Real-world note-level evaluation still needs OLiMPiC-system-level or
   controlled captures; note-level certification on arbitrary user scans is not
   yet established.
4. CC BY-SA datasets need legal review for adapted-data redistribution.
5. Tremolo/uncommon notation needs an MEI path.
6. Synthetic-to-scan model transfer is an open empirical question.

## 14. CASE A/B/C

**CASE A — NEW TRUTH ROUTE FOUND.**

- Condition: **C** (genuinely stronger source-correspondence method) proven by
  the small proof; **A** (substantially more complete PDF↔source
  correspondence) satisfied in practice by PDMX's same-source pairs at
  ~192k piano scale. B is not needed.
- Why it changes available information: correspondence is declared and
  verified instead of recovered from pixels; the population is no longer
  identity-ambiguous.
- Exact next proof/build: the PDMX pilot (below).
- Estimated scale: 192,777 piano-including candidates (182,464 piano-only),
  plus 53,882 GrandStaff systems, ~1,300 OpenScore songs, 2,124 Mutopia pieces;
  real-world evaluation from OLiMPiC and controlled captures.
- Legal status: see §3 — the core sources are commercially usable.
- Piano Vision can now reopen: **yes, scientifically**, as a data-engineering
  and benchmark-construction campaign.

## 15. Is Piano Vision scientifically justified to reopen?

**Yes**, under the formal conditions (C proven; A materially available). The
reopen is for **building the truth pipeline and frozen benchmarks**, not for
another heuristic iteration and not yet for model training. The old clean-gate
protocol is replaced by: exact element-join verification on self-rendered
sources, same-source whole-score evaluation, and a real-scan system-level
acceptance benchmark.

## 16. Exact next step

**PDMX pilot, CPU-only, no training:**

1. Download `PDMX.csv` + `subset_paths.tar.gz` (already done in research) and
   `mxl.tar.gz` (1.9 GB).
2. Select piano, `no_license_conflict`, `all_valid` rows; take a deterministic
   pilot sample (e.g. 1,000 scores, split by composer).
3. Render with pinned Verovio version + seed; run the element/state join;
   record load/join failures; quarantine failures.
4. Emit paired dataset v0 (element tables + provenance records) and a frozen
   held-out manifest.
5. Stand up the OLiMPiC scanned evaluation harness (system-level edit
   distance).
6. Produce the frozen zero-parameter baseline report on the held-out sets.
7. Only after that: decide on training.

## 17. Is any RTX/model training justified yet?

**No.** The prerequisite is now a *dataset and benchmark*, not a model. RTX
becomes justified only after the pilot produces verified paired data, a frozen
real-world acceptance benchmark, and a zero-parameter baseline that identifies
a model/representation problem. The old campaign's three reasons for no RTX
(no truth baseline, informational block, ceiling not in model capacity) are
being resolved by data work first, exactly as required.
