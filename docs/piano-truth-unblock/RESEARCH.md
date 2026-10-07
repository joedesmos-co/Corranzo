# Piano Vision truth-unblock — research report

Worktree: `/Users/ryland/Documents/scoreflow-piano-unblock`
Branch: `codex/piano-truth-unblock` (base `4e677015e6`, the V2.6 closure state)

This report investigates whether a genuinely new, practical source of
independently trustworthy Piano ground truth exists. It does not train a model,
does not touch Corpus 2.1, and does not read the closed residual fields.

---

## 1. P0 — Previous blocker, in facts

From `tools/piano-vision-v26-audit/FINAL_STATUS.md` (commit `4e677015e6`):

- Formal status: **INDEPENDENT PIANO SOURCE-TRUTH CERTIFICATION: BLOCKED**.
- The clean gate was **NOT_EVALUATED**, because independently recoverable
  correspondence was insufficient (N=12 noteheads vs required ≥50).
- Eleven automated routes were tested (geometry audit, canonical staff
  recovery, cross-staff barline consensus, measure-identity mapping, onset
  subsets, two raster onset detectors, three blinded AI-consensus rounds, and a
  pitch-blind structural DP aligner). All bottomed out on missing information.
- Established: PDF staff geometry is recoverable; page-space transforms are
  sound; cross-staff structure is useful; many apparent mismatches are
  population-identity problems; Corpus 2.1 under-covers the rendered source;
  automatic note identity in dense piano notation is insufficient with those
  inputs.
- Not established: that the 1,104 mismatches are source errors; that Corpus 2.1
  labels are wrong; that PDF or MusicXML is final truth; that Piano capability
  was measured; that the clean gate failed.
- The blocker is informational, not architectural: the missing ingredient is
  ground truth about note identity, which the old inputs do not contain.
- Reopen conditions: (A) substantially more complete PDF↔source
  labels/correspondence, (B) human/source-assisted annotation at useful scale,
  or (C) a genuinely stronger OMR/source-correspondence method.
- RTX was not justified: no truth baseline, compute cannot synthesise missing
  truth, and every ceiling traced to correspondence/coverage.

**Why the old campaign could not win.** It tried to *recover* correspondence
between two documents (a third-party PDF and a MusicXML) that were not
guaranteed to be the same edition, and then had to certify the correspondence
from pixels. The two new routes below remove that problem at the root instead
of measuring it harder.

---

## 2. P1 — Dataset and source research

### 2.1 The key structural insight

Every dataset below falls into one of three classes:

| class | what it gives | correspondence status |
|---|---|---|
| **Self-rendered symbolic** | symbolic source + deterministic render from *that same source* | exact by construction if the renderer exposes element mapping |
| **Same-source engraved pairs** | PDF and symbolic exported from one engraving file | source identity exact; element-level mapping still needs a renderer/OMR |
| **Real scanned + symbolic** | real scan with human symbolic labels | real-world visual domain; correspondence quality varies (region/system-level vs note-level) |

The old campaign's inputs were none of these: the PDF and MusicXML were
different documents of uncertain relation. That is the identity problem.

### 2.2 Self-rendered symbolic corpora (training truth)

| corpus | scale | source | rendering | licence | commercial |
|---|---|---|---|---|---|
| **PDMX** | 254,077 songs; **192,777 piano-including** no_license_conflict + all_valid; **182,464 piano-only** | MuseScore user scores, PD/CC0 | MXL + **PDF** + MID shipped (same-source exports) | dataset **CC BY 4.0**; underlying CC0/PD; `no_license_conflict` subset | yes (attribution) |
| **OpenScore Lieder** | ~1,300 songs (voice + piano) | 19th-c. lieder, transcribed from IMSLP PD editions | MuseScore file + MusicXML + PDF + MIDI | **CC0** | yes |
| **Mutopia Project** | 2,124 pieces | PD editions, LilyPond typeset | PDF + LilyPond source + MIDI | CC BY-SA / CC BY / PD | yes |
| **GrandStaff** | 53,882 single-system piano scores | KernScores (PD) | Verovio renders + kern/bekern truth | HF packaging **MIT**; GrandStaff-LMX **CC BY-SA 4.0** | yes |
| **MSMD** | 497 piano pieces, 344,742 aligned noteheads | Mutopia LilyPond | LilyPond PDF + PNG + MuNG + exact LilyPond source location per notehead | **CC BY 4.0** (Zenodo) | yes |
| **PrIMuS / Camera-PrIMuS** | 87,678 monophonic incipits | RISM PAEC | Verovio render + MEI + semantic/agnostic encodings; Camera adds photo distortions | official page states **no licence** | **unclear — avoid for shipped training** |
| **DeepScoresV2** | 255,385 pages, 151M instances, 135 classes | MuseScore MusicXML | LilyPond render at 400 DPI with injected SVG symbol annotations | **CC BY 4.0** | yes |
| **DoReMi** | ~6,400 images | Dorico test scores | MusicXML + MEI + OMR XML with bboxes + Dorico event IDs | repo states **no licence**; only openly distributable subset published | **unclear — avoid for shipped training** |

The PDMX counts above were computed directly from the official `PDMX.csv`
(254,077 rows) and `metadata.tar.gz` (instrument field), not from secondary
summaries: 215,485 songs list piano as an instrument, of which 192,777 pass
`no_license_conflict` **and** `all_valid` (MXL+PDF+MID present), and 182,464 are
piano-only instrument sets. PDMX ships the MuseScore PDF alongside the MXL for
the `all_valid` subset, which makes it a same-source PDF↔MusicXML corpus at
scale (authors' documentation; see uncertainty 1).

### 2.3 Real scanned/engraved music with symbolic truth (evaluation)

| dataset | scale | image | truth | licence | commercial |
|---|---|---|---|---|---|
| **SMB** (ISMIR 2025) | 685 pages, 4,039 regions | **real scanned** pages from KernScores, pianoform/quartet/mono | human-verified `**kern` per region + region bboxes | **CC BY-NC 4.0**, gated on HF | **no** (research/internal only) |
| **OLiMPiC 1.0** | piano systems from OpenScore Lieder; scanned dev/test + synthetic train/dev/test | synthetic = MuseScore PNG; **scanned = IMSLP page images with manually annotated system bboxes** | LMX / MusicXML per system | **CC BY-SA 4.0** | yes, with share-alike on adapted data (legal review advised) |
| **CVC-MUSCIMA** | 1,000 handwritten sheets | handwritten | staff lines, writer identity; staff-removal masks | research registration | no |
| **MUSCIMA++** | 140 handwritten pages, 91,255 symbols, 23,352 notes | handwritten | symbol graph (MuNG), notehead/stem/beam relations, pixel masks | **CC BY-NC-SA 4.0** | **no** |
| **HOMUS** | 15,200 handwritten symbols | pen strokes / rendered symbol images | 32 symbol classes | no stated licence | unclear |
| **ASAP** | 236 piano scores, 1,067 performances | no images | aligned MusicXML + MIDI + beat/downbeat | repo **CC BY-NC-SA 4.0** | no |
| **IMSLP** | >650k scores | real scans/engravings | none (no symbolic alignment) | public domain varies by jurisdiction | only as image source |

### 2.4 Licence / commercial-use findings

- **Safe for a commercial pipeline (with attribution where required):** PDMX
  (CC BY 4.0 dataset; underlying PD/CC0; use `no_license_conflict`), OpenScore
  Lieder (CC0), Mutopia (CC BY / CC BY-SA / PD per piece), MSMD (CC BY 4.0),
  DeepScoresV2 (CC BY 4.0), GrandStaff (MIT on HF packaging; GrandStaff-LMX
  CC BY-SA 4.0), OLiMPiC (CC BY-SA 4.0 — share-alike attaches to redistribution
  of adapted dataset material; legal review advised, model weights are not
  automatically derivative under common interpretations).
- **Not usable for shipped commercial training:** MUSCIMA++ / CVC-MUSCIMA
  (NC), ASAP (NC), SMB (NC), and any MuseScore.com content outside PDMX's
  PD/CC0 selection.
- **Avoid due to licence ambiguity:** PrIMuS, DoReMi, HOMUS (no clear licence
  on official sources).
- **Dataset packaging vs underlying works:** PDMX's own licence is CC BY 4.0,
  but the *songs* were selected as Public Domain / CC0; the dataset authors
  recommend the `no_license_conflict` subset because 12.29% of rows had a
  public-vs-internal licence conflict. Use that subset.

### 2.5 Download / access risk

- PDMX Zenodo record `10.5281/zenodo.15571083`: `mxl.tar.gz` 1.9 GB,
  `pdf.tar.gz` 9.6 GB, `mid.tar.gz` 214 MB, `metadata.tar.gz` 159 MB,
  `data.tar.gz` 2.2 GB, `PDMX.csv` 225 MB, `subset_paths.tar.gz` 29 MB. Stable,
  but a 12–15 GB full pull; the pilot can use the CSV + MXL first.
- OpenScore Lieder and Mutopia are small (GitHub / HTTP, per-file).
- GrandStaff (HF) is a parquet dataset; GrandStaff-LMX is on Lindat.
- SMB is gated (HF contact acceptance) and NC.
- OLiMPiC scanned is 215 MB on Lindat; stable.
- PrIMuS/DoReMi downloads exist but licence blocks their use.

---

## 3. P2 — Self-rendered symbolic truth (the preferred route)

### 3.1 What was verified (proof: `proof/REPORT.md`)

Verovio 6.3.0 is installed in the working environment and is the same engraver
the old campaign already used for the "independent render" side, so this route
adds no new dependency risk.

Verified mechanics:

- `tk.getMEI()` returns MEI with `xml:id` on notes, rests, accidentals, beams,
  tuplets, ties, slurs, articulations, dynamics, hairpins, tempo, ornaments,
  arpeggios, glissandi, pedal, octave shifts, fingerings, fermatas, directions,
  endings, and measure/staff/layer containers.
- `tk.renderToSVG()` renders each element as a `<g id="...">` whose id equals
  the MEI id for all event classes, and emits **official bounding boxes**
  (`svgBoundingBoxes`) as `<g id="bbox-ID">` rects.
- `tk.getElementAttr(id)` returns the semantic attributes of any rendered
  element, including layout-generated state elements (clef/keySig/meterSig).
- With `xmlIdSeed` fixed, SVG output is **byte-identical across processes**.
  Without it, ids are random (geometry unchanged).
- The renderer does not rewrite notes, ties, slurs, beams, tuplets, dynamics,
  hairpins, pedal, octave, arpeggios, glissandi, fingerings, ornaments or
  fermatas; all were id-joined at 100% in the proof.
- Rasterisation: Verovio SVG → PNG with `sharp` at arbitrary resolution
  (2480×3507 ≈ 300 DPI A4 in the proof), deterministic. Verovio does not emit
  PDF; the vector SVG can be converted with any vector→PDF tool, or used
  directly for rasterisation. No PDF is required for the truth chain.

### 3.2 The correspondence architecture

```
source MusicXML/MXL (hash H_src, licence record)
  -> Verovio (version V, seed S)          [render hash H_render]
     -> MEI  = symbolic truth (ids, ancestry, pitch/duration/notation)
     -> SVG  = layout truth (ids, bboxes, staff lines, systems)
  -> join  = exact element table (id -> measure/staff/layer/pitch/bbox)
  -> paired sample (image + element table + provenance record)
```

Because the symbolic source is the render input, correspondence is not
*recovered* from pixels; it is *declared* by the renderer and then
machine-verified. This is the information the old campaign lacked.

### 3.3 Limits found (full detail in `proof/REPORT.md`)

- clef/keySig/meterSig rendered groups do not carry MEI ids; they are resolved
  by an exact semantic state join (641/641 in the proof), not by id.
- MusicXML single tremolo is dropped by the Verovio importer.
- Partial rests can normalise to durationless `<mRest>` in an unusual
  voice/staff-switch layout; rest truth should come from the source file.
- Octave shifts: `oct` is the printed (shifted) pitch and `oct.ges` the source
  pitch (1,827/4,388 notes in la-campanella); both must be stored.
- Large-corpus import failure rate is not yet measured (pilot step).

---

## 4. P3 — Domain gap: legitimate bridging without destroying truth

The self-rendered domain is cleaner than user photos/scans. The bridge must be
applied to the **image only**, with the transform recorded, so labels stay
exact. Transforms and their label rules:

| transform | parameters | effect on labels | rule |
|---|---|---|---|
| scale / resolution | target staff-gap px | none | record px-per-staff-gap; reject below a pre-registered readability floor |
| rotation / skew / shear | affine matrix | exact | map label points (bbox centres/corners) by the same matrix; store the matrix |
| perspective | 3×3 homography | exact | map points by H; store H and its inverse; store oriented boxes, not axis-aligned, or store centres only |
| crop | translation (+ optional scale) | exact if element remains in frame | mark clipped elements; never relabel a partially visible element as complete |
| page curl / lens distortion | smooth warp field W(x,y) | exact if W invertible | map points by W; store W; reject non-invertible warps |
| blur / defocus | Gaussian σ, motion kernel | none | labels unchanged; store σ |
| JPEG / compression | quality, chroma | none | labels unchanged |
| illumination / contrast | gain field, gamma | none | labels unchanged |
| noise / paper texture / print simulation | seeded models | none | labels unchanged; seed recorded |
| combined | warp then photometric | exact | labels = W(clean labels); photometric last; store both recipes |

Discipline that keeps this scientifically legitimate:

1. The truth record is always the **pre-transform** symbolic identity.
2. Every geometric transform is stored as a matrix/field and is invertible by
   construction (or the sample is rejected).
3. Photometric transforms are recorded as parameter vectors with seeds.
4. A sample's reproducibility key is
   `(source hash, renderer version, seed, transform recipe, quality verdict)`.
5. Severity is sampled from pre-registered ranges, not tuned against model
   performance; the quality gate (section 6) uses measurable image properties.

This is not "use augmentation"; it is a **render-transform-paired data
generator** where every transformed coordinate is valid because the transform
is known and recorded.

---

## 5. P4 — Real-world held-out validation strategy

The purpose is a benchmark that does not recreate the old correspondence
ambiguity. Four tiers, in order of preference:

1. **OLiMPiC scanned dev/test (real scans, system-level truth).** Pianoform
   system crops from IMSLP page images, manually annotated system bounding
   boxes, LMX/MusicXML ground truth from the OpenScore transcription of the
   same edition. Evaluation at system/region level with an OMR-NED-style edit
   distance avoids pixel correspondence. Licence CC BY-SA 4.0. This is the
   cheapest genuinely real-world held-out set and the recommended primary
   benchmark.
2. **Controlled Corranzo captures (real photo/scan, exact truth by
   construction).** Print our own CC0 renders, scan/photo them under a
   controlled protocol (several devices, lighting, skew, resolution), keep the
   source truth, and verify registration by re-rendering and aligning. The
   transform is unknown but *measurable*; only samples whose registration is
   verified (feature alignment plus a human spot-check) enter the benchmark.
   This gives real-world noise with exact truth and no licensing risk.
3. **Same-source engraved PDFs at scale (PDMX / OpenScore).** Evaluate
   whole-score transcription with an edit-distance metric against the MXL that
   generated the PDF. No element mapping is needed, so the old ambiguity does
   not arise; this tests engraving-style realism (MuseScore) rather than
   camera realism.
4. **SMB (real scans, human `**kern`, CC BY-NC).** Excellent benchmark quality
   but non-commercial; usable only for internal research evaluation, not in
   shipped training or commercial evaluation, unless the licence is
   renegotiated.

The benchmark should be frozen (source hashes + expected outcomes) before any
model training, exactly as the old campaign's pre-registration discipline
required.

---

## 6. P5 — Notation coverage

Target vocabulary vs what MusicXML→Verovio→SVG actually provides (proof
counts in parentheses are joined elements across the 11-score proof):

| target | source representation | rendered/labelled | notes |
|---|---|---|---|
| notes/chords/rests | note/rest, chord members | yes (9,534 notes, 757 rests) | rest durations from source; mRest edge case |
| clefs/key/time | clef/keySig/meterSig | yes, semantic state join (641/641) | no id link; exact state join |
| accidentals/dots | accid/dot | yes (1,590 accid) | |
| beams | beam | yes (1,317) | |
| tuplets | tuplet | yes (113) | |
| ties/slurs | tie/slur | yes (156/110) | |
| articulations | artic | yes (2,335) | |
| dynamics/hairpins | dynam/hairpin | yes (143/75) | |
| ornaments | trill/mordent/turn | yes (5/1/1) | |
| grace notes | note@grace | yes (attribute; rendered) | |
| cue notes | note@cue | yes (attribute; rendered) | |
| fingerings | fing | yes (1) | |
| pedal | pedal | yes (238) | |
| octave shifts | octave + oct.ges | yes (40 elements; 1,827 shifted notes) | printed vs source pitch recorded |
| tremolos | trem/bTrem/fTrem | **no** | MusicXML single tremolo dropped |
| arpeggios/glissandi | arpeg/gliss | yes (70/1) | |
| tempo/rehearsal/directions | tempo/reh/dir | yes (318/1/21) | |
| repeats/endings/navigation | ending + barlines | partial (ending 2) | repeat semantics are source-level, not glyph-level |
| text/directions | dir | yes (21) | |
| multi-voice | layer | yes | |
| cross-staff | note@staff | yes (probe; source staff ancestry exact; geometric nearest-staff heuristic 97.05% and ambiguous on ledger/octave-shift placements) | |
| uncommon notation | varies | not exhaustively tested | pilot must quantify import failures |

Sufficiency is not "contains noteheads": the pipeline must be judged on the
full table. On current evidence the route covers all target classes except
tremolo (dropped) and navigation semantics (source-level); both have known
workarounds (MEI input for tremolo; source-level navigation labels).

---

## 7. P6 — Quality-gate data

The same generator produces labelled rejection examples without contaminating
truth:

- **Blur:** Gaussian/motion kernels with recorded σ; a pre-registered
  readability floor (staff-gap px and edge-energy) defines reject labels.
- **Resolution:** downscale to staff gaps below the floor; reject.
- **Skew/perspective:** extreme angles beyond a pre-registered bound; reject.
- **Lighting/contrast:** gain fields and gamma beyond bounds; reject.
- **Crop:** content loss beyond a fraction of the page/staff; reject.
- **Compression:** JPEG quality below a bound; reject.
- **Unreadable notation:** overlapping/severe occlusion synthesis; reject.

Labels are produced by measurable image properties, never by model output, so
the gate remains non-circular. The in-repo precedent is the CC0
`guitar-paired-scan` fixture with `expectedOutcome: reject-honestly`.

---

## 8. P7 — Training/adaptation dashboard compatibility

The architecture below avoids the corner cases the product will hit later. It
is a data contract, not an implementation:

- **Pair record:** `{source_path, source_sha256, licence, provenance,
  renderer_version, seed, render_sha256, transform_recipe, quality_verdict,
  join_report, split}`.
- **Source identity verification:** re-render the source with the pinned
  renderer+seed; compare `render_sha256` (or normalised geometry) to the stored
  value; mismatch = quarantine.
- **Render/alignment verification:** re-run the element/state join; require
  id-join pass for all non-state classes and state-join resolution for all
  state groups; store the report with the pair.
- **Quality checks:** measurable properties + expected outcome, as in P6.
- **Train/validation provenance:** split by source score/composer/collection,
  never by rendered fragment or transformed view; split membership is stored
  in the manifest and hashed.
- **Dataset versioning:** content-addressed keys; append-only manifests;
  frozen evaluation manifests; renderer/seed/transform pinned.
- **Incremental adaptation:** new pairs render only the new sources; the
  10-PDF+MXL upload batch becomes a manifest of 10 source hashes with their
  verification reports.
- **Reproducible evaluation:** expected outcomes and metrics frozen before
  training; note-level metrics from element tables, whole-score metrics from
  edit distance (OMR-NED style).

---

## 9. P10 — Falsification results

Full detail in `proof/REPORT.md`. Summary:

- **Source ids lost?** No for notes/rests/events (9,534/9,534 notes; all
  non-state classes 100%). Yes for clef/keySig/meterSig rendered groups — but
  they carry their semantics and are resolved exactly by the state join.
- **Layout coordinates unstable?** No. Deterministic with `xmlIdSeed`;
  official bboxes; measure/staff ancestry exact. A naive geometric
  nearest-staff heuristic agrees with source staff ancestry for 9,253/9,534
  notes (97.05%); the 281 disagreements are ledger-line/between-staff and
  octave-shift placements where the heuristic is ambiguous, not source loss.
- **Grace/cue notes omitted?** No; both preserved and rendered.
- **Cross-staff ownership lost?** No; probe cross-staff note joined and landed
  on the correct visual staff.
- **Voices collapsed?** No; layers are preserved (multi-voice fixtures join).
- **Ties/slurs hard to map?** No; both id-join.
- **MusicXML lacks layout semantics?** MusicXML itself is layout-agnostic, but
  the renderer supplies layout; the source is the truth and the layout is
  derived, so this is not a gap.
- **Renderer rewrites/normalises notation?** Some: tremolo dropped; octave
  shifts change printed pitch; rare rest normalisation. All characterised.
- **Licensing prevents use?** No for PDMX/OpenScore/Mutopia/MSMD/GrandStaff/
  DeepScoresV2/OLiMPiC; yes for NC and unlicensed datasets.
- **Synthetic domain gap too large?** Unproven either way; the transform
  generator (P3) and the real-world benchmark (P4) are the designed mitigation
  and the next empirical question. This does not affect truth reliability, only
  transfer.

---

## 10. Remaining uncertainties

1. **PDMX same-source PDF↔MXL pairing is documented by the dataset authors,
   not independently verified here** (verifying needs the 1.9 GB MXL and
   9.6 GB PDF tarballs). The pilot must verify a sample: parse MXL, render with
   the pinned pipeline, and confirm the shipped PDF is the same engraving
   (page/measure structure and pitch content).
2. **Verovio import success rate on PDMX-scale corpora is unknown.** MuseScore
   exports can contain quirks; the pilot must measure load/join failure rates
   and define the quarantine path.
3. **Real-world note-level evaluation is not yet possible without human
   verification or controlled captures.** OLiMPiC gives system-level truth;
   controlled captures give exact truth but require a capture protocol.
4. **CC BY-SA datasets (OLiMPiC, GrandStaff-LMX) require legal review** for
   redistribution of adapted dataset material; model-weight derivative status
   is jurisdiction-dependent.
5. **Tremolo and some uncommon notation need an MEI-input path or another
   renderer** to be labelled.
6. **Model generalisation from renders to scans is an open empirical
   question**; it is a training/transfer question, not a truth blocker.
