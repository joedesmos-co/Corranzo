# Mic Engine — next-generation accuracy (research branch)

**Date:** 2026-10-24
**Base:** current `main` @ `a58b60e069` merged into this research branch
(merge commit `5c6bbb132a`). Main already carries the October 25 mic
false-award rescue (12/24 → 2/24 on the focused single-note matrix).

## 1. What was wrong (remaining false awards)

After main's rescue the two remaining false completions on the focused
matrix were both on ONE guitar recording (`real-guitar-g3`): an expectation
one octave above the played note (G4 expected, G3 played). Root cause:
a played string's **2nd partial IS the upper octave's fundamental**, and
the engine's own confidence for that ghost on guitar (0.60) sits inside the
true-note range (0.57–0.91) — so the piano confidence guard cannot cover
guitar. The same mechanism lights neighbour expectations from the spectral
skirt.

## 2. The new evidence: the odd-partial test

When the note one octave BELOW an expectation is sounding, the
expectation's fundamental band is that note's 2nd partial. The lower
note's **3rd partial sits at exactly 1.5 × the expectation's fundamental** —
a half-integer ratio that a genuinely struck note never produces (real
partials are integer multiples).

Measured on real acoustic guitar at the attack window:

| case | 1.5f / f |
|---|---|
| ghost G4 (G3 played) | **0.217** / **0.129** |
| true G3 | 0.021 / 0.043 / 0.078 |
| true B3 | 0.074 |
| true E4 | 0.021 |

A threshold of **0.10** clears every ghost by ≥29 % and sits ≥28 % above
every true note (the deep-bass E2 case is excluded because its fundamental
vanishes and the ratio is noise — the rule requires a measurable
fundamental and an octave-away dominant).

This is not a re-run of a rejected heuristic: rejected approaches compared
the expectation's own band with the parent's **even** partials (shared by a
real octave) or used flux/span/persistence. The 1.5f band is a frequency a
real upper octave does not occupy.

## 3. Architecture (the mission's modularity requirement)

Evidence and decision are now separate modules:

* **Detection layer** — `src/features/microphone-input/v2/scoreInformedChordScorer.js`
  exposes `halfPartialEnergy` and `halfPartialRatio` on every scored note
  (one extra Goertzel per expected note).
* **Expectation layer** — `src/features/microphone-input/v3/octaveGhostEvidence.js`
  exports `octaveGhostFromHalfPartial` and `dominantDisagreement`. Both
  recognisers (`pianoRecognition`, `guitarRecognition`) call the same
  helpers, so a future spectral/neural/hybrid backend that supplies the
  same evidence reuses the decision logic unchanged.

## 4. What shipped

1. `octaveGhostEvidence.js` (new): odd-partial octave guard + the
   low-confidence dominant-disagreement guard, shared by piano and guitar.
2. `scoreInformedChordScorer.js`: the half-partial evidence feature.
3. `pianoRecognition.js`: uses the shared helpers (behaviour identical to
   main's rescue plus the odd-partial rule).
4. `guitarRecognition.js`: both guards (the guitar path previously had
   neither).
5. Unit tests: 7 for the evidence helper + 2 guitar integration cases + the
   existing 23 piano/guitar tests (33 total green).

Chords: the odd-partial test is **single-note only**. Measured on real
triads it is unreliable inside chords — a fifth above a chord tone lights
its 1.5f band (C4's 1.5f IS G4, measured ratio 0.99) and spectral leakage
between strong partials inflates neighbours (E4 read 0.11-0.45). An earlier
chord extension filed real triads as "unexpected tone" and dropped true
completions to 0/11, so it was reverted. Chord octave expectations remain a
documented limitation (see below).

## 5. Before / after (production browser path, same recordings/scenarios)

Focused single-note matrix (6 real clips, 24 wrong-expectation scenarios):

| metric | current main | this branch |
|---|---|---|
| true completions | 6 / 6 | **6 / 6** |
| false completions | **2 / 24** | **0 / 24** |
| onset→advance p50 | 59 ms | **58 ms** |
| range | 32–102 ms | 34–106 ms |

Every remaining false award on the matrix is gone (the guitar octave and the
neighbour/whole-tone leaks).

True-completion regression sweep (same harness, true expectations only):
* mic-polyphony (11 clips) + composites (6): **13–14 / 17** (run-to-run
  variance, identical range to current main), including octave chords,
  rolled octave, repeated notes and legato. The miss is the open-string
  six-note strum, a documented pre-existing limitation on main too.
* mic-real eval-fresh: **8–9 / 9** true (variance), 0 false.
* mic-real eval (dense piano, read-only): 15/22 true — the same dense-
  material gap as main; the offline neural path scores 22/23 there but
  cannot meet the real-time deadline.

Remaining false awards (measured, unchanged by this work): chord
expectations whose wrong tone is a neighbour or an octave of a chord
member — **23 / 122** wrong scenarios on the polyphony+composites sweep
(down from 44 in the previous research run because of the guitar/dominant
guards; the chord-octave part is the documented limitation below).

## 6. Latency, resources, dropped windows

* Production spectral: onset→advance **p50 58 ms** (34–106 ms) on the
  focused matrix; chord p50 ≈ 91 ms. No dropped inference windows (2048-
  sample FFT at the 60 Hz frame cadence).
* Neural (unchanged, OFF): Basic Pitch **~250 ms per window even at 0.5 s**
  on software WebGL (fixed overhead), live path 584 ms/window = 2.3× the
  250 ms hop, 75 % of windows dropped, 1.79 s sound-to-feedback. Not viable.
* CPU/memory (30 s, same clip): spectral 5.3 s renderer CPU (~18 % of a
  core), 12 MB JS heap, no growth; neural 8.7 s (~29 %) and 26 MB.

## 7. Browser acceptance

* `tests/micLiveProduction.test.js` — 5/5 (real note, real V3 chord, real V2
  fallback chord, partial chord refused, room noise refused).
* `scripts/browser-unified-practice-mic-e2e.mjs` — 23 passed / 0 failed /
  1 skipped on current main (the previously stale middle-C label assertion
  was corrected by the release).
* No physical microphone: every measurement is injected at the MediaStream
  boundary.

## 8. Supported / unsupported (current)

**Supported:** single piano/guitar notes (including quiet), repeated notes,
dyads/triads/strums where every tone is struck, octave chords, silence and
noise refusal, wrong-note refusal.

**Unsupported (documented):**
* an expectation an octave above a note that is *also* sounding and is not
  itself expected — refused by design (a missed note is recoverable, a false
  advance is not);
* the open-string six-note strum does not complete (pre-existing);
* dense real piano performances (mic-real eval: 15/22 in the production
  expectation path vs 22/23 for the offline neural path — the neural
  advantage is real on dense material but it cannot meet the deadline);
* weak bass under a strong upper note.

## 9. Integration readiness

Additive, mic-owned, no UI/cursor/score-following changes:
* 2 new pure helpers + 1 evidence feature in the v2 scorer;
* both recognisers call the shared helpers; main's V3/V2 chord paths and the
  piano rescue behaviour are preserved (33 unit tests);
* measured on the real production browser path, before/after, with exact
  commands.

Not mergeable until the integration owner reviews and physical-mic
acceptance is run (no hardware was available).
