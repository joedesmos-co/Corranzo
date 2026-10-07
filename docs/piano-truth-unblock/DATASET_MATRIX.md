# Piano truth-unblock — dataset decision matrix

Scores are 0–5 (5 = best). "Commercial" means usable for a commercial product's
training/adaptation under the stated licence, with attribution where required.
"Truth" means how trustworthy and exact the symbolic labels are for the image.

| # | source | truth reliability | correspondence completeness | notation coverage | piano relevance | real-world realism | scale | commercial | engineering effort | download risk | reproducibility | training value | evaluation value |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **PDMX → self-render (Verovio)** | 5 | 5 (renderer-declared, verified) | 4 (tremolo gap) | 5 (192,777 piano) | 2 (rendered) | 5 | 5 (CC BY 4.0 / PD) | 3 | 3 (1.9 GB MXL first) | 5 (seed-pinned) | 5 | 4 (synthetic held-out) |
| 2 | **PDMX same-source PDF+MXL (direct)** | 4 (identity documented, not yet verified) | 3 (score-level, no glyph mapping) | 4 | 5 | 3 (MuseScore engraving) | 5 | 5 | 2 | 3 (12–15 GB full) | 4 | 4 (engraving realism) | 4 |
| 3 | **OpenScore Lieder** | 5 | 5 with self-render | 4 | 2 (voice+piano) | 3 (engraved) | 3 (~1,300) | 5 (CC0) | 2 | 1 | 5 | 3 | 3 |
| 4 | **Mutopia** | 5 | 5 with self-render (LilyPond path) | 4 | 4 | 3 | 2 (2,124) | 5 (CC BY / BY-SA / PD) | 3 (LilyPond toolchain) | 1 | 5 | 3 | 3 |
| 5 | **GrandStaff** | 4 (rendered truth) | 5 (kern/bekern pairs) | 3 (single-system piano) | 5 | 2 | 5 (53,882) | 4–5 (MIT on HF; LMX BY-SA) | 1 | 1 | 5 | 4 | 4 |
| 6 | **MSMD** | 4 | 5 (exact LilyPond source location per notehead) | 3 | 5 | 2 | 3 (497) | 5 (CC BY 4.0) | 3 | 2 | 4 | 3 | 3 |
| 7 | **DeepScoresV2** | 3 (object detection, not notation semantics) | 3 | 3 (symbols, not music structure) | 3 | 2 | 5 (255k pages) | 5 (CC BY 4.0) | 2 | 3 (large) | 4 | 3 (detection pretrain) | 2 |
| 8 | **PrIMuS / Camera-PrIMuS** | 4 | 4 | 1 (monophonic incipits) | 1 | 3 (Camera distortions) | 5 | 1 (no stated licence) | 2 | 2 | 3 | 2 | 2 |
| 9 | **DoReMi** | 4 | 4 (bboxes + event ids) | 4 | 3 | 2 | 3 | 1 (no stated licence) | 2 | 2 | 3 | 2 | 2 |
| 10 | **MUSCIMA++ / CVC-MUSCIMA** | 4 | 4 (symbol graph) | 3 | 2 | 4 (handwritten) | 3 | 0 (NC) | 3 | 2 | 4 | 2 (handwriting) | 2 |
| 11 | **SMB** | 5 (human-verified `**kern`) | 4 (region-level, real scans) | 4 | 5 (pianoform) | 5 (real scans) | 2 (685 pages) | 0 (CC BY-NC) | 2 | 4 (gated) | 4 | 3 (research only) | 5 (research only) |
| 12 | **OLiMPiC scanned** | 4 (system-level truth) | 3 (system-level, same edition) | 3 | 4 (pianoform) | 5 (real IMSLP scans) | 2 (dev/test systems) | 4 (CC BY-SA) | 2 | 2 | 4 | 3 | 5 |
| 13 | **OLiMPiC synthetic** | 4 | 5 (LMX/MusicXML per system) | 3 | 4 | 2 | 3 | 4 (CC BY-SA) | 2 | 2 | 4 | 3 | 3 |
| 14 | **ASAP** | 4 | 4 (score/performance alignment) | 3 | 5 | 1 (no images) | 3 | 0 (NC) | 3 | 2 | 4 | 2 | 1 |
| 15 | **HOMUS** | 3 | 4 (symbol-level) | 1 | 1 | 4 (handwritten) | 3 | 1 (no stated licence) | 2 | 1 | 3 | 1 | 1 |
| 16 | **Controlled Corranzo captures (proposed)** | 5 (truth by construction) | 5 (verified registration) | 4 | 5 | 5 (real camera/scan) | 2–4 (as built) | 5 (CC0 sources) | 4 | 1 | 4 (protocol) | 4 | 5 |
| 17 | **Corpus 2.1 (old)** | 2 (identity uncertain) | 1 (the blocker) | 4 | 5 | 4 (real PDFs) | 2 | 3 | — | 1 | 2 | 1 | 1 |

## Ranking and rationale

1. **PDMX self-rendered (1)** — the only route with proven, machine-checkable
   element-level correspondence (9,534/9,534 notes in the proof), 192,777
   commercially clean piano sources, seed-pinned reproducibility. Weakness:
   synthetic visual domain.
2. **OLiMPiC scanned (12) + controlled captures (16)** — the real-world
   evaluation pair. OLiMPiC is available now; captures give exact truth with a
   real camera.
3. **PDMX same-source PDF+MXL (2)** — real engraving style at massive scale and
   trivial licensing, with score-level (not glyph-level) correspondence;
   verification of the same-source claim is the next cheap step.
4. **GrandStaff (5) / MSMD (6)** — strong alternative render corpora, smaller
   and partly single-system; useful for diversity and as held-out sets.
5. **SMB (11)** — best real-scan benchmark but NC; research evaluation only.
6. **DeepScoresV2 (7)** — useful for detector pretraining, not for notation
   semantics.
7. **MUSCIMA++ (10) / ASAP (14) / PrIMuS (8) / DoReMi (9) / HOMUS (15)** —
   rejected for the shipped pipeline on licence and/or coverage grounds.
8. **Corpus 2.1 (17)** — remains historical only; not a truth source.

## Notes on scoring

- "Correspondence completeness" distinguishes *element-level* mapping (5) from
  same-source *identity* without glyph mapping (3–4).
- "Real-world realism" scores the image domain, not the label quality.
- "Commercial" reflects the licence of the data actually needed (images +
  symbolic + annotations), not just the dataset landing page.
- No candidate scores 5 on every axis; the architecture is deliberately a
  portfolio: **PDMX self-render for training truth, OLiMPiC/captures for
  real-world evaluation, SMB for internal research only.**
