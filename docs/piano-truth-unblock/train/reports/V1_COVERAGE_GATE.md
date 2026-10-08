# P6 rare-class strategy + P7 data coverage gate

Support numbers: TRAIN/DEV counts from `manifests/v1_support.json` (+ event
build). Gate verdict per V1 family: A adequate / B rare-with-strategy /
C needs-data / D explicitly-unsupported.

## Fixed rare-class strategy (no TEST involvement)

1. **Unbiased base**: train100 for all common heads (frozen, hash-ranked).
2. **Targeted supplementation**: trainRare = deterministic feature search over
   TRAIN (up to 4 scores per rare feature, hash-ranked; never TEST) for
   grace, cue, octave shifts, arpeggios, glissandi, ornaments, fingerings,
   pedal, hairpins, endings, repeats, tuplets, ties, slurs.
3. **Loss weighting**: uniform loss (validated recipe). Sqrt inverse-frequency
   weights were tried during a confounded debugging period (a normalization bug
   invalidated those runs), so no clean conclusion about weighting exists;
   uniform is adopted because it is proven, with balanced sampling reserved
   for the full campaign if rare heads need it.
4. **No arbitrary synthesis** in V1; no rare-class tuning on TEST (or DEV
   beyond plain model selection).

## Coverage gate (P7)

| family | TRAIN / DEV support | gate | note |
|---|---|---|---|
| notes, rests, chords, onset, duration, dots | 130k/22k notes; 4k/628 rests | A | — |
| beams / beam groups | 26k / 4.3k | A | — |
| tuplets (flat) | 1,017 / 129 | A | maxdepth 1 corpus-wide |
| nested tuplets | 0 examples | C | unverified mapping + no data |
| ties / slurs | 2.5k/315, 2.2k/394 | A | — |
| grace notes | 743 / 214 | A- | pitch head weak, support fine |
| cue notes | 36 / **0** | B | train-supervised; no DEV metric; capture set must include cue |
| clef / key / meter state | all scores | A | state join |
| accidentals | 5,404 / 499 | A | — |
| staccato etc. (rendered artics) | 4.2k / 139 | A | — |
| scoop/doit/fall/plop | not rendered | D | honest behavior: quarantine path |
| fermata | 135 / 12 | A- | — |
| dynamics / hairpins | 581/41, 236/8 | A- | — |
| trill | 177 / 52 | A- | — |
| mordent | 43 / 7 (10 / 1 scores) | B | targeted scores + weights |
| turn | 1 / 0 | C | single example |
| pedal + changes | 1,142 (11 scores) / dev-weak | B+ | targeted scores + weights |
| fingerings | 106 (3 scores) / 62 (1 score) | B | targeted; dev metric single-score |
| octave shifts | 73 el. (6 scores) / 1 score, 8 notes | B | targeted; dev metric weak |
| arpeggiation | 170 (9 scores) / 1 | B | + quarantine path for unrendered |
| tremolo (bTrem/fTrem) | 3+? / 14 | B | encoding-dependent; detector enforced |
| single-tremolo encodings that drop | per-source | D | honest behavior: quarantine path |
| glissandi | 1 / 1 scores | C | cannot evaluate; needs expansion |
| tempo + metronome | 406 / 32 | A- | — |
| text/directions (typed dir, D.C./Fine/...) | common | A- | semantic text join |
| rit. text | dropped from MEI (4 scores), visible w/o identity | D | honest behavior: not a tempo change |
| rehearsal marks | 59 / 2 | B | targeted |
| repeats / endings | 560 / 64 scores w/ tokens; 242 / 35 endings | A | — |
| volta brackets (standalone) | 0 examples | C | endings cover function |
| segno / coda symbols | 12 / 6 scores | B | repeatMark id join |
| barlines / measure numbers | every measure / 6+1 scores | A / C | mNum needs expansion |
| breath / caesura | 1 / 0 | C | single example |
| playback-order semantics | computation, not data | B- | schema holds links; decoder is next |

No family is UNKNOWN. C-items have a concrete expansion plan: feature-token
search over the full 182k PDMX corpus (same detector as the inventory), then
the verified render+join pipeline — no new methods needed.
D-items have honest product behavior (quarantine or explicit non-transcription).
