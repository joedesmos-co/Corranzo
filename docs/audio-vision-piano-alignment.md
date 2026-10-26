# Audio Vision — piano alignment validation and final research decision

Research only. No model retraining, threshold change, main merge or deployment.

## Milestone 1 — Independent piano offset verification

Independent waveform analysis (median truth-onset → nearest energy attack) vs
align-probe bestDelta (spectral-flux peak grid search):

| clip | independent median offset | align-probe delta | agree? |
|---|---|---|---|
| mozart-single | −105 ms | 0 ms | YES |
| mozart-dyad | −5 ms | −525 ms | **NO** |
| mozart-triad | +6 ms | 0 ms | YES |
| mozart-dense | −40 ms | 0 ms | YES |
| schubert-single | −220 ms | −125 ms | **NO** |
| schubert-triad | −139 ms | −175 ms | **NO** |
| schubert-dense | −203 ms | −825 ms | **NO** |
| mozart2-triad | −104 ms | −750 ms | **NO** |
| schubert2-single | +268 ms | −800 ms | **NO** (opposite) |
| schubert2-triad | −30 ms | −850 ms | **NO** |

**Critical finding:** the align-probe deltas are NOT waveform-supported for 7/10
piano clips. The spectral-flux grid search overfit to spurious peaks. The
align-probe bestDelta values (−0.5 to −0.85 s) are 3–8× larger than the
independent energy-attack offsets (−0.03 to −0.22 s) and sometimes opposite in
direction.

**Therefore, the piano F1 "improvement" (0.068 → 0.274) was a re-scoring
artifact from applying an incorrect, overfit correction.** The true piano
baseline remains ~0.068 (raw). The align-probe correction must not be used
for piano evaluation.

The honest picture: piano truth onsets are generally ~100–200 ms early with
high clip-to-clip variance and many weak/grace-note attacks. The exact
correction is not reliably determinable from the available evidence.

## Milestone 2 — Held-out validation

**No suitable held-out piano set exists.** All 11 piano clips are dev (4) or
eval (7); none are eval-fresh. The align-probe correction was derived on the
same clips it was evaluated on (data leakage). Generalization cannot be claimed.
This must be documented as a limitation, not a result.

## Milestone 3 — Error attribution (after honest baseline)

With raw scoring (no correction), piano F1 0.068, recall 0.071. The low
scores are dominated by:
- Annotation timing (truth ~100–200 ms early, variable).
- Grace/short notes (67 grace-short, 40 short out of 191 piano notes).
- Negative onsets (8 notes started before clip).
- Weak attacks (low RMS, 2 notes).

Guitar (raw): acoustic F1 0.779, electric 0.708. Clear-note recall 0.80–0.81.
Guitar's gap is onset timing on dense chords and weak attacks, not alignment.

Pitch-only recall (soft, 12 clips): 0.926. The model detects pitches; timing
and annotation quality are the confounds.

## Milestone 4 — Small targeted experiment

No independently supported extractor defect emerged. The onset threshold
0.65→0.50 candidate (+0.03 F1) adds false notes and doesn't help piano.
Onset snapping is harmful. No bounded correction is justified.

## Milestone 5 — Stop or continue

**Recommendation: pause Audio Vision model/extractor research.**

Rationale:
1. The apparent piano "improvement" was an artifact of an overfit,
   waveform-unsupported correction. The true piano baseline is ~0.07 F1 with
   raw scoring — but this underestimates true performance due to annotation
   timing. Neither the raw nor the "corrected" number is trustworthy.
2. Guitar performance (0.71–0.78 F1) is reasonable and consistent with the
   0.772 GuitarSet number.
3. Pitch detection is ~0.93 on real audio. The model is not the bottleneck.
4. No held-out piano set exists to validate any correction.
5. No independently supported extractor defect remains after honest
   evaluation.

**Data requirement to reopen research:** a rights-cleared real-audio corpus
with (a) independently verified, waveform-aligned onset labels (not
model-optimized), (b) separate dev/eval/eval-fresh splits with enough piano
clips for held-out validation, (c) per-note stratum labels (clear, short,
grace, muted, weak) so metrics are reported per stratum, and (d) a
false-note regression suite before any threshold change.

Preserve: Basic Pitch weights, trainable reconstruction, rights-clean synthetic
corpus, alignment manifests, evaluators, Audio Vision v3 editing system.

## Resource usage

No large downloads. Disk ~11 GiB. No training.

## Artifacts

- `scripts/audio-vision-piano-offset-verify.mjs` — independent offset check.
- `docs/audio-vision-piano-alignment.md` — this report.
- Prior artifacts preserved (canonical-manifest, real-bench, etc.).
- Tests: `tests/synthCorpus.test.js` (10) pass. Production untouched.
