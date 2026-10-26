# Audio Vision — polyphonic masking, bass recovery and real-domain evidence

Research only. No training; production weights unchanged.

## 1. Real-audio masking evidence (rights-cleared)

Measured on 6 GuitarSet takes + 4 Vienna piano clips (same material as the
domain-gap study). Per onset cluster (onsets within 80 ms):

| | avg notes/cluster | bass-cluster share | bass energy share | high energy share | onset spread | overlap share (prev note still sounding) |
|---|---|---|---|---|---|---|
| real guitar | 1.82 | 0.18 | **0.763** | 0.024 | 11 ms | 0.391 |
| real piano | 2.80 | 0.10 | **0.078** | 0.001 | 27 ms | 0.167 |

Two findings reshape the hypothesis:

1. **The bass fundamental is not weak in absolute energy** on guitar (76 % of the
   band energy). The earlier "bass recall 0.425" headline was an artifact of
   averaging takes that contain *no* bass notes. On the comp takes that
   actually have bass, recall is 0.7-1.0. The real bottleneck is the
   **mid register** (0.59-0.76) and **dense clusters** (0.38-0.71), not bass.
2. **Real failures correlate with short notes** (staccato/muted, 0-0.12 recall)
   and **dense simultaneous sounding** (3-5 concurrent notes, 0.38 recall),
   not with bass level. Octave errors ~8 per 350 notes.

Artifact: `benchmarks/audio-vision/real-masking.json`.

## 2. Masking transforms implemented

`maskComposition()` in `scripts/lib/synthCorpus.mjs`: per-note level rebalance
(bass x0.32, mid x0.85, high x1.15), quiet inner voices (x0.4), and sustained
overlap (+0.35 s) — all applied to the note list before rendering, so velocity
and offset (ground truth) reflect the change. Single-mechanism variants
(levels-only, sustain-only) allow paired causal isolation.

## 3. Paired causal result — masking does NOT reproduce the real failure shape

Same 12 compositions, unchanged production extractor, one mechanism at a time:

| mode | micro F1 | R | bass | mid | short | dense R | dense F1 | quiet | oct | false |
|---|---|---|---|---|---|---|---|---|---|---|
| clean | 0.933 | 0.969 | 1.000 | 0.985 | — | 0.927 | 0.951 | 1.000 | 7 | 16 |
| timbre | 0.956 | 0.956 | 0.945 | 0.982 | — | 0.917 | 0.913 | 1.000 | 3 | 13 |
| performance | 0.948 | 0.962 | 1.000 | 0.973 | 0.972 | 0.886 | 0.904 | 0.949 | 3 | 14 |
| levels | 0.960 | 0.957 | 0.945 | 0.985 | — | 0.927 | 0.937 | 0.952 | 3 | 9 |
| sustain | 0.926 | 0.935 | 0.917 | 0.979 | — | 0.907 | 0.933 | 1.000 | 5 | 14 |
| maskFull | 0.930 | 0.935 | 0.917 | 0.979 | — | 0.907 | 0.933 | 0.938 | 5 | 13 |
| perfMask | 0.927 | 0.948 | 1.000 | 0.958 | 0.963 | 0.865 | 0.882 | 0.960 | 3 | 21 |
| **real GuitarSet (comp)** | **~0.74-0.83** | **~0.62-0.76** | **~0.7-1.0** | **~0.59-0.76** | **~0.0-0.12** | **~0.38-0.71** | **~0.39-0.66** | — | **~8/350** | **~0.3-0.4/note** |

Synthetic dense recall stays 0.87-0.93 against real 0.38-0.71; synthetic short-note
recall 0.96-1.00 against real 0.00-0.12. **The failure shape did not converge.**

## 4. Isolation experiments (negative)

- **Short notes alone**: 100-200 ms notes in isolation or dense polyphony are
  detected with recall 1.0 / 0.92 (synthetic). Real short notes score 0.00-0.12.
  Duration alone is not the cause.
- **Full 6-string voicings**: recall 0.976 with masking. Polyphony count alone
  is not the cause.
- **Levels alone / sustain alone / combined**: each moved the score by at most
  -0.03 and left dense recall >= 0.90.

The model is robust to every acoustic, performance, and masking variation tested.

## 5. What this means

The synthetic corpus does not reproduce the real failure mechanisms. The gap is
not explained by timbre, performance timing, dynamics, level balance, sustained
overlap, short notes, or polyphony count in isolation or in combination.

The remaining candidate explanations are outside what additive synthesis with
these controls can test:

- Genuine acoustic recording conditions (mic, room, instrument body) as a
  *combined* system rather than single-pole approximations.
- Real playing styles and articulations (palm muting, slides, buzzes, grace
  notes) that are not clean note onsets.
- The evaluation labels themselves (JAMS onsets include grace notes and mutes
  that may not be clean onsets).
- Training-objective mismatch (the released model's frame-level BCE may be
  miscalibrated for the real distribution).
- Model capacity / architecture limits of the compact Basic Pitch model.

## 6. Training decision

**Not justified.** The corpus still fails the mission's own gate (relevant real
error categories not reproduced). A pilot now would repeat the two documented
failures. The synthetic data remains useful as a *controlled probe* for model
behaviour, but not as training data that would improve real recall.

## 7. Recommended next experiment (research pause / pivot)

1. Collect/verify more rights-cleared real audio with exact, audible-onset
   labels (extend GuitarSet-style coverage; the inspected sets are not sealed).
2. Obtain or generate independent per-note stems so mixing experiments use real
   acoustic sources rather than additive approximations.
3. Re-examine the evaluation labels: quantify how many JAMS "notes" are grace
   notes/mutes/buzzes that are not clean onsets; this may explain part of the
   apparent recall gap.
4. If training is revisited, change the objective (not just the data): the
   previous weighted-BCE run collapsed onset recall 0.72 -> 0.06; a focal or
   cost-sensitive loss on the real distribution is the untested lever.
5. Consider whether a compact model can reach the released model's real recall
   at all, or whether the limit is capacity.

## 8. Artifacts

- `scripts/lib/synthCorpus.mjs` — `maskComposition()` added.
- `scripts/audio-vision-masking-bench.mjs` — 9-mode paired benchmark.
- `scripts/audio-vision-real-masking.mjs` — real cluster/masking measurement.
- `scripts/audio-vision-shortnote-test.mjs`, `audio-vision-shortnote-dense.mjs`,
  `audio-vision-fullvoicing-test.mjs` — isolation experiments.
- `benchmarks/audio-vision/masking-bench.json` — per-composition rows + summaries.
- `benchmarks/audio-vision/real-masking.json` — real cluster evidence.
- `docs/audio-vision-masking.md` — this report.
- Tests: `tests/synthCorpus.test.js` (10) still pass.

Storage: no large audio materialised; all on-demand. Disk ~8 GiB, above the 5 GiB floor.
