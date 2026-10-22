# Microphone A/B: production spectral (V2) vs experimental neural

Measured 2026-10-21 on the frozen corpora with **identical clips, identical
scenarios and identical denominators** (both scorers use the shared scenario
generator `scripts/lib/micFalseAwardScenarios.mjs`).

## How each engine was measured

| Engine | Method | Notes |
|---|---|---|
| **Spectral (production)** | `scripts/benchmark-spectral-corpus.mjs` — offline replay of the SHIPPED modules: `processMicEngineV2Tick` (v2 score-informed), `evaluateMicScoreInformedInput` / `evaluateMicMatch`, `micMatchConfirm`, `micAttackLatch`, `micMusicalAcceptance` | Same modules the live Wait For You path uses; the React glue and the V3 score-expectation layer are not reconstructed (V3 needs a score, which the corpus does not carry) |
| **Neural (experimental)** | `scripts/benchmark-neural-corpus.mjs` → `scripts/score-neural-notes.mjs` — real TF.js Basic Pitch in Chromium, then the production stream filters + hybrid confirmation | Default-OFF path; identical scenario generator |

Both are **injected-stream tests** (recorded clips played through a
MediaStream). Neither is physical-microphone evidence.

## Results

| Corpus | Clips | Scenarios | Spectral true | Spectral FP | Neural true | Neural FP |
|---|---|---|---|---|---|---|
| legacy (mic-accuracy + mic-polyphony) | 17 | 134 | 11 | **14** | **16** | 3 |
| mic-real dev | 15 | 16 | 8 | 1 | **13** | 0 |
| mic-real eval (read-only) | 23 | 29–30 | 13 | 3 | **22** | 1 |
| mic-real eval-fresh | 9 | 7 | 4 | 0 | **9** | 0 |
| composites | 6 | 12 | 4 | 0 | **6** | 0 |
| **TOTAL** | **70** | **199** | **40 (57%)** | **18** | **66 (94%)** | **4** |

Per instrument (spectral, all corpora): piano 13/24 (54%), acoustic guitar
11/21 (52%), electric guitar 12/18 (67%), other guitar 4/6 (67%).
Neural, same corpora: piano 24/24, acoustic guitar 19/21, electric guitar
18/18 (measured in the previous mission's runs).

## Where each engine fails (measured, not assumed)

**Spectral (production)**
- *False awards*: 18. Dominant family = **octave confusion** — the
  score-informed scorer is asked "is the EXPECTED pitch present?" and a
  played note's 2nd partial satisfies an octave expectation (7 of 14 legacy
  FPs are `octave-up-of-X`). Neighbour expectations leak from the spectral
  skirt of a played note (`neighbor±1-of-X`).
- *Missed completions*: chords whose tones are each detected but never
  confirmed. Browser-measured: the real C-major triad does not complete in
  the v2/collection path (90 s, real MediaStream injection).

**Neural (experimental)**
- *False awards*: 4/199 (2 octave co-attack harmonics, 2 decay-phase
  semitone confabulations) — seven measured feature domains failed to
  separate them (see `MIC_FALSE_AWARD_RESEARCH_LOG.md`).
- *Missed completions*: 4 (model-bound weak fundamentals: rock-69,
  funk-43, strum-45 and one masked piano tone).

**Complementarity**: the spectral path HEARS notes the neural path misses
(rock-69, funk-43 — its score-informed scoring is good at weak
fundamentals); the neural path completes chords the spectral path cannot
confirm. A hybrid (neural blind evidence + spectral score-informed
confirmation) is the theoretically strongest option but is not implemented
in this window.

## Root cause of the spectral chord gap (browser-confirmed)

Two DISTINCT chord paths exist in the shipped product:

**(a) V3 performance-expectation path (default, V3 is ON).** The hook
builds a performance expectation from the checkpoint, so the V3 engine
owns the chord decision. Browser-measured on the real C-major triad: the
v2 engine detects all three tones every frame (`det=[60,64,67]`), the
feedback says "3/3 matched", and the checkpoint still never advances —
the V3 match result does not emit COMPLETE for the chord. The remaining
blocker lives in the shared V3 layer, not in the microphone code.

**(b) V2 collection path (fallback: V3 off, or no expectation could be
built — imported scores without performance expectations).** This path
collected **one monophonic pitch per frame**, two monophonic-only guards
dropped frames carrying valid POLYPHONIC v2 evidence, and the collection's
single pending-index counter rotated when several expected tones arrived
in one frame, so no tone ever reached its stable-hit count.

Fixes shipped in this window (mic-owned modules only):
1. `micChordPolyphonyEvidence.chordCollectionEvidenceMidis` — the tones to
   feed the collection (v2 polyphonic detections, which are a subset of the
   expected tones, plus the monophonic pitch).
2. `waitForYouMicChordCollection` — per-expected-tone hit counters, so
   polyphonic evidence can accumulate; a wrong note still clears progress.
3. `useWaitForYouMicInput` — the two monophonic-only guards no longer
   discard frames that carry chord polyphonic evidence, and a chord is no
   longer confirmed by MONOPHONIC clarity (the autocorrelation clarity of
   three simultaneous tones is low by construction, so the old gate
   rejected every real chord).

Browser-verified result: with the v2 path (`?v3=0`) the real C-major triad
now completes — "Heard C4 + E4 + G4 — all tones matched" (real MediaStream
injection, real capture code, real v2 detector, real checkpoint).

## Recommendation

Do NOT replace the production recognizer on the strength of the neural
numbers alone:
- The neural path needs a model download and a WebGL/CPU backend
  (measured ~260 ms per 0.5 s window on SwiftShader; ~1 s on CPU), and it is
  still experimental.
- The spectral path is free, offline, and 10× cheaper, and it hears weak
  fundamentals the neural path misses.

The measured, safe wins for the production path in this window are the
chord-collection fixes above plus the honest supported range below.

## Honest supported range (production spectral path, measured)

- **Reliable**: single notes (piano/guitar, mf–ff), open strings, dyads
  where both tones are strong, repeated notes.
- **Conditional**: chords — only when every tone is detected strongly and
  the tones are sustained enough for the gate to stay open.
- **Not reliable**: sustained dense chords (gate closes), weak bass
  fundamentals in the presence of a strong upper note, and any checkpoint
  whose expectation is an octave/neighbour above the played note (the
  score-informed scorer cannot distinguish a harmonic from the note).

Wait For You should not advance on a checkpoint whose expectation is an
octave or a semitone neighbour of the note the player actually produced,
unless the player strikes it separately — the spectral engine cannot tell
those apart.
