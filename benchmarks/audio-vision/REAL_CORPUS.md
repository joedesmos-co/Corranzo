# Audio Vision real acceptance corpus

Local-eval-only audio. **No corpus audio is committed to this repo or
redistributed.** The manifests below record provenance so anyone can
re-materialize the corpus with `node scripts/audio-vision-fetch-corpus.mjs`.

## Sources

| id | content | license | truth | grade |
|---|---|---|---|---|
| `mic-real-*` (in-repo `benchmarks/mic-real/`) | 3 s natural clips: Vienna 4x22 piano, GuitarSet acoustic, EGSet12 + guitar-techs electric | CC-BY-4.0 (per-clip attribution in `benchmarks/mic-real/manifest.json`) | clip `truth.notes` | graded (note P/R, onset MAE) |
| `chopin-noct19-faulkner` | Musopen/Luke Faulkner, Chopin Nocturne 19, 30–75 s excerpt | Public domain (recording) | none | ungraded acceptance |
| `bag-of-motifs` | ccMixter "A Bag Of Motifs" (Radioontheshelf feat. Spinningmerkaba): vocals+guitar+drums+bass+piano, 20–65 s excerpt | CC BY-NC, **local eval only, never redistribute** | none | ungraded acceptance |
| `guitarset-jazz-solo`, `guitarset-ss-comp` | GuitarSet full performances (jazz solo 14 s @200 BPM; singer-songwriter comping 46 s), Zenodo record 3371780 (md5-verified) | CC-BY-4.0 | JAMS: per-string notes, beats, tempo, chords, key | graded (melody recall, tempo error, chord accuracy) |

## What the numbers mean

- `melStrict`: fraction of truth melody anchors (highest pitch per onset
  cluster) matched exactly (±0.25 s) in the arrangement.
- `melPc`: same, pitch-class match (octave displacement allowed — legitimate
  in solo arrangement).
- `tempoErr`: |estimated − truth| BPM. `chordRoot`: fraction of truth chord
  spans with a same-root analyzed chord overlapping.
- Real vs synthetic are always reported separately. Synthetic controls
  (`audio-vision-eval.mjs`) cannot satisfy real-song acceptance.

## Known data caveats

- Vienna piano clips: DSP-only alignment probe (`audio-vision-align-probe.mjs`,
  no model involved) finds systematic truth offsets on EVERY piano clip
  (δ −0.125 to −0.85 s; guitar clips sit at δ≈0 with rate≈1.0), plus ~50–60%
  of piano truth onsets cluster within 75 ms. Raw note-level piano P/R is
  therefore truth-limited, not just model-limited.
- Piano rescue (`audio-vision-piano-rescue.mjs`, δ applied equally to both
  methods, never used for tuning): schubert-p02 clips jump BP F1 0.03→0.56–0.64
  from alignment alone (model was largely right; reference is wrong).
  **Quarantine recommendation (energy evidence, awaiting mic-corpus owners):**
  `piano-schubert2-single`, `piano-schubert2-triad` (δ≈−0.8 s, take-consistent).
  `piano-mozart2-triad` δ=−0.75 did NOT transfer (aligned worse) — per-clip δ
  must not be applied blindly; take-consistent groups only.
- Even aligned, soft polyphonic piano F1 ≈ 0.15–0.64: genuinely weaker than
  guitar. No piano accuracy claims beyond single notes (BP hits pp piano
  singles exactly) until drift-free polyphonic truth exists.
- 3 s mic-real clips probe detection, not arrangement; arrangement-grade
  evidence comes from the 14–46 s GuitarSet/Chopin/ccMixter entries.
- Untruth-graded entries are marked "awaiting musician review" for subjective
  musical quality — no listening was available during automated evaluation.
