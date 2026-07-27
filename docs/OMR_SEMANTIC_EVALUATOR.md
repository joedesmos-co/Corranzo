# OMR Semantic MusicXML Evaluator

Status: **FROZEN for recognition sprints (v2.0.0 / schema 2)**  
Module: `src/features/omr/semanticMusicXmlEvaluator.js`  
CLI: `node scripts/evaluate-omr-semantic.mjs`  
Corpus: `node scripts/omr-semantic-corpus-eval.mjs` (`npm run omr:semantic-corpus`)  
Schema: `schemaVersion` **2** · evaluator **2.0.0**

> **Freeze rule:** Do not change scoring formulas, tolerances, class definitions,
> or defect codes while improving OMR recognition. Capture before/after against
> this stick. Process: `docs/OMR_RECOGNITION_QUALITY.md`.
> Baseline: `benchmarks/omr-semantic/`.

## Purpose

Every uploaded PDF should be evaluable against ground-truth MusicXML with
**musical semantics**, not a boolean “different.” Recognition must not change
until this evaluator’s self-check and golden fixtures pass.

## CLI

```bash
# Compare files
node scripts/evaluate-omr-semantic.mjs --truth gt.musicxml --generated omr.musicxml --json report.json

# Written-only (ignores performed timeline expansion)
node scripts/evaluate-omr-semantic.mjs --truth gt.musicxml --generated omr.musicxml --mode written

# Self-check (must be 100% / zero defects)
node scripts/evaluate-omr-semantic.mjs --self-check gt.musicxml --mode written

# Semantically equivalent encodings (divisions / voice renumbering)
node scripts/evaluate-omr-semantic.mjs --equivalent a.musicxml b.musicxml --mode written

# Compact one-liner
node scripts/evaluate-omr-semantic.mjs --truth gt.musicxml --generated omr.musicxml --compact
```

## Modes

| Mode | Compares |
| --- | --- |
| `written` | Written measures, notes, markings, tempo on the quarter grid. **Ignores** performed repeat expansion. |
| `performed` | Sounding duration, performed measure timeline, measure wall-clock timing. |
| `both` (default) | Written note/marking comparison **plus** performed playback section. |

Repeats / voltas / D.C. / D.S. / coda in **written** mode are interpretation
marks on the written score. They must not make pitch/rhythm look wrong merely
because one file expands playback and the other does not.

## Alignment strategy

Written measures are fingerprinted (length, pitched-count, MIDI histogram,
onset signature, pickup/implicit) and aligned with Needleman–Wunsch that also
allows **split** (1→2) and **merge** (2→1) transitions.

- Missing / extra measures are explicit alignment ops (`missing-measure`, `extra-measure`).
- Expensive 1:1 pairs above `alignmentMaxPairCost` are downgraded to unmatched.
- Report includes `alignment.confidence`, matched/unmatched counts, and per-pair costs.

## Matching strategy

Within each aligned measure group:

1. Normalize to quarter-note onsets/durations (divisions-invariant).
2. Default staff `1`; keep staff lanes hard-separated.
3. Canonicalize voice numbers by staff + first onset + mean pitch (1/2 ≡ 5/6).
4. Min-cost bipartite matching with hard constraints: same staff, same canonical voice, rest↔rest, onset within match window.
5. Chords: per-note matching inside onset buckets; one missing chord member → one `missing-note`, not a cascade of attribute errors.

## Error independence

| Layer | What it counts |
| --- | --- |
| Detection | Missing / extra notes (and rests). A missing note does **not** also charge duration, tie, or articulation. |
| Attributes | Pitch, duration, onset, tuplet, tie, articulation — **only** on matched pairs. |

## Score formulas

For each class:

```
denominator = TP + FP + FN
numerator   = TP
score       = denominator == 0 ? 1 : TP / denominator
coverage    = presentInTruth == 0 ? 1 : compared / presentInTruth
reliable    = coverage >= 0.25 || presentInTruth == 0
```

Overall = mean of **reliable** class scores.

Low coverage is shown explicitly (`98% (low coverage 10%)`) — do not trust a
high score when almost nothing was compared.

### Class opportunities

- **Pitch** — detection (missing/extra) + pitch attribute on matches  
- **Rhythm** — duration / onset / tuplet on matches + rest detection/duration  
- **Sustain** — tie presence/type on matches that have ties  
- **Articulation** — staccato/accent/tenuto/marcato on matches that have marks  
- **Measure structure** — alignment, measure length, staff lanes, chords, voice-lane collapse  
- **Interpretation** — repeats, voltas, D.C./D.S./coda/segno, tempo (written grid)  
- **Playback** — performed duration, timeline, measure seconds (**performed** mode)

## Tolerances (musical units)

See `src/features/omr/semanticEvalTolerances.js` (also embedded in JSON `tolerances`):

| Quantity | Default |
| --- | --- |
| Onset | 0.125 quarters |
| Duration | 0.125 quarters |
| Match window | 0.75 quarters |
| Rest match window | 0.5 quarters |
| Chord onset bucket | 0.08 quarters |
| Measure length | 0.125 quarters |
| Tempo | 2 BPM / 0.5 quarters |
| Playback duration | 0.35 s (performed mode only) |
| Measure timing | 0.2 s (performed mode only) |
| Quarter epsilon | 1e-6 |

## Normalization before compare

- Divisions → quarter units  
- Enharmonic spelling → MIDI (`enharmonicPolicy: 'midi'`)  
- Voice renumbering (canonical ranks)  
- Staff defaulting  
- Chord member order (match by MIDI, not document order)  
- Implicit / pickup via fingerprints  
- `backup`/`forward` already resolved by `parseMusicXml`  
- Ties via `<tie>` and `<tied>` (parser)  
- Articulation presence (order irrelevant)

## Report fields

- Class blocks: numerator, denominator, TP/FP/FN, ignored, unsupported, coverage, reliable  
- `alignment` confidence + pairs  
- `measures` / `worstMeasures` (weighted severity)  
- `firstDivergence`  
- `topDefects` / `topDefectClasses`  
- `schemaVersion`, `evaluatorVersion`, `gitCommit`  
- Compact console: `--compact`

## Golden fixtures

`tests/semanticMusicXmlEvaluator.hardening.test.js` asserts exact defect codes
and denominators for: wrong pitch, missing note, quarter vs eighth, missing dot,
missing rest, missing tie, tie↔slur, missing staccato, wrong voice, missing
measure, pickup, repeat, tempo, chord missing member, staff separation,
self-check, equivalent divisions/voices.

## Known unsupported MusicXML features

Listed on every report as `unsupportedFeatures`, including ornaments, fermatas,
dynamics continuum, hairpins, ottava, cue/grace playback, cross-staff beam
encoding details, figured bass, lyrics (except jump words), multi-part
alignment beyond the primary written sequence, score-timewise, microtones.
