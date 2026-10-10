/**
 * Phase 1 — Real acceptance corpus manifest (audio NOT committed).
 *
 * Audio stays local-only (never bundled/redistributed): this manifest records
 * URLs, excerpt offsets, licenses and attribution; scripts/audio-vision-fetch-corpus.mjs
 * materializes the wavs. Truth notes come from in-repo manifests or JAMS sidecars.
 *
 * Entries:
 *  - mic-real-*: in-repo natural 3 s clips (CC-BY-4.0, attribution in
 *    benchmarks/mic-real/manifest.json): Vienna 4x22 piano, GuitarSet acoustic,
 *    EGSet12 + guitar-techs electric. Truth: clip truth.notes.
 *  - chopin-noct19: Musopen/Luke Faulkner performance of Chopin Nocturne 19
 *    (public domain recording). Unlicenced-for-truth: ungraded acceptance.
 *  - bag-of-motifs: ccMixter "A Bag Of Motifs" (Radioontheshelf feat.
 *    Spinningmerkaba; site default CC BY-NC — LOCAL EVAL ONLY, never
 *    redistribute). Multi-instrument mix, ungraded acceptance.
 *  - guitarset-*: full GuitarSet performances (CC-BY-4.0, Zenodo 3371780)
 *    with JAMS truth. Added when the mic-track archive finishes downloading.
 */
export const REAL_CORPUS = {
  version: 1,
  audioPolicy: 'local-eval-only; no corpus audio is committed or redistributed',
  sources: [
    {
      id: 'mic-real',
      kind: 'in-repo',
      license: 'CC-BY-4.0',
      attribution: 'Per-clip attribution in benchmarks/mic-real/manifest.json (Vienna 4x22, GuitarSet, EGSet12, guitar-techs)',
    },
    {
      id: 'chopin-noct19-faulkner',
      kind: 'remote',
      url: 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Chopin_-_Nocturne_No._19_in_E_minor%2C_Op._72_No._1_%28Luke_Faulkner%29.flac',
      license: 'Public domain (recording)',
      attribution: 'Luke Faulkner via Musopen (Chopin Nocturne No. 19 in E minor, Op. 72 No. 1)',
      excerpt: { startSeconds: 30, durationSeconds: 45 },
      truth: null,
    },
    {
      id: 'bag-of-motifs',
      kind: 'remote',
      url: 'https://ccmixter.org/content/Radioontheshelf/Radioontheshelf_-_A_Bag_Of_Motifs.mp3',
      fetch: { referer: 'https://ccmixter.org/files/Radioontheshelf/71053' },
      license: 'CC BY-NC (ccMixter site default; treat as non-commercial local eval only)',
      attribution: 'Radioontheshelf feat. Spinningmerkaba, "A Bag Of Motifs" (vocals, guitar, drums, bass, piano)',
      excerpt: { startSeconds: 20, durationSeconds: 45 },
      truth: null,
    },
    {
      id: 'guitarset-full',
      kind: 'zenodo',
      record: 'https://zenodo.org/records/3371780',
      license: 'CC-BY-4.0',
      attribution: 'GuitarSet (Xi et al., ISMIR 2018): acoustic guitar performances + JAMS annotations',
      tracks: [],
    },
  ],
}
