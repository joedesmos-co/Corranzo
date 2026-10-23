# Mic recognition — real-time accuracy rescue (research branch)

**Date:** 2026-10-22
**Base:** `main` @ `57e04123a8` merged into `codex/neural-mic-reliability`
(merge commit `524e9f55a1`). All numbers below are measured on that merged tree;
none are quoted from the stale branch.

## 1. Current-production baseline (real browser, real capture, real audio)

`scripts/benchmark-production-corpus.mjs` drives the REAL production hook
(`useWaitForYouMicInput`, V3 performance expectations + V2 fallback) in
Chromium with real labeled recordings injected at the MediaStream boundary.
The offline module replay (`scripts/benchmark-spectral-corpus.mjs`) does NOT
include calibration, the attack latch, monophonic corroboration or the V3
expectation path, so its numbers are **not** production numbers.

| set | clips | true completions | false completions (wrong-expectation scenarios) | onset→advance |
|---|---|---|---|---|
| mic-accuracy (single notes) | 6 | **6/6** | 11 / 24 | p50 ≈ 90 ms (range 50–130 ms) |
| mic-polyphony (chords/dyads/strums) | 11 | 7/11 | 42 / 110 | p50 ≈ 105 ms |
| mic-composites (repeats, octaves, legato) | 6 | 6/6 | 0–2 / 12 | 62–90 ms (legato 2.1 s: the second note arrives late) |

Single notes: 100 % true completion, but **46 % of wrong expectations falsely
completed** — the observable production defect.

## 2. Actual audio used

* `benchmarks/mic-accuracy/clips/*.wav` — real piano/guitar single notes
  (licensed within the repo), truth = `expectedMidi`.
* `benchmarks/mic-polyphony/clips/*.wav` — real dyads/triads/strums, truth =
  `expectedMidis`.
* `benchmarks/mic-composites/clips/*.wav` — construction-truth composites
  (repeated notes, octave pairs, rolled octave, legato).
* `benchmarks/mic-real/*` — the independent JAMS/MIDI-annotated corpus
  (dev/eval/eval-fresh) used by the neural scorer.

## 3. Root cause of the false awards (new evidence)

A played note's harmonic satisfies the score-informed evidence for an
expectation an octave (or a tone) above the played pitch, and V3 accepted it
because:

1. `frameCorroboratesSingleNote` compares pitch **modulo 12** and is
   deliberately octave-invariant ("autocorrelation octave flips are not
   contradictions" — unit-pinned), so an octave-away played note never
   contradicts the expectation.
2. V3's own dominant-pitch disagreement rule requires `clarity ≥ 0.5`
   (`dominantWrongToneMinClarity`). Measured across six real clips: every
   octave false accept had clarity **0.28–0.46**, below the gate, while every
   true accept had **0.57–0.91**. The rule therefore never fired on the ghosts.
3. The v2 detection floor (`minConfidence: 0.28`) is low enough for the ghost's
   score-informed confidence to count as "detected".

Instrument dependence: the same measurement on **guitar** found the ghost at
confidence **0.60** (a plucked string's 2nd partial is strong), inside the true
range — so a confidence bar cannot be the only rule for guitar.

## 4. Implemented improvement

`src/features/microphone-input/v3/pianoRecognition.js`:

* **Dominant-disagreement gate lowered for chords/notes**: the unexpected-tone
  rule now fires at `dominantWrongToneMinClarity: 0.35` (was 0.5). A correctly
  played note or chord has its own pitch class as the dominant, so the rule is
  inert for true playing; it only rejects frames whose dominant pitch class is
  neither expected nor an octave-safe member.
* **Single-note octave-ghost guard** (`octaveGhostMinExpectedConfidence: 0.5`):
  when exactly one note is expected and the dominant is an octave (or a tone)
  away, the expectation's own score-informed confidence must reach 0.5 to
  override the disagreement. Measured separation on piano: ghosts 0.28–0.46,
  true notes 0.57–0.91. Chords are untouched (their completion is owned by the
  V3 chord path and the V2 fallback, both fixed on main).

Both are single, documented option constants; no V3 acceptance logic, cursor or
notehead behaviour was changed. Unit tests added (4) alongside the existing 9.

## 5. Before / after (production path, same recordings, same scenarios)

| set | true before → after | false before → after |
|---|---|---|
| mic-accuracy (6) | 6 → **6** | 11 → **5** (piano ghosts eliminated; 5 guitar remain) |
| mic-polyphony (11) | 7 → **8*** | 42 → **33** |
| mic-composites (6) | 6 → **6** | 2 → **0** |
| **total** | 19 → **20** | **55 → 38 (−31 %)** |

\* one-clip run-to-run variance on the polyphony set (7–8); the FP reduction is
consistent across runs.

## 6. Latency and dropped windows

* Production spectral: onset→advance p50 **≈ 90 ms** (measured 50–130 ms on
  single notes; 62–105 ms on chords). No dropped inference windows: the v2 tick
  is a 2048-sample FFT at the 60 Hz frame cadence.
* Neural experimental: Basic Pitch inference measured **250 ms** per window at
  0.5 s (248–254 ms over three runs; 254 ms at 0.25 s, **no scaling below 1 s**;
  443 ms at 1.5 s) on software WebGL (SwiftShader). The live path adds
  resampling/rendering, measured by main at **584 ms/window** — **2.3× the
  250 ms hop**. Main's live run: 84 hop attempts → 21 windows actually run
  (**75 % dropped**), sound-to-feedback **1.79 s**.

Deadline analysis: to keep up on the measured runtime the hop would have to be
≥ 600 ms, i.e. ≥ 1 s sound-to-feedback before confirmation — strictly worse than
the spectral path's ~90 ms. Shortening the window does not help (fixed model
overhead). **Verdict: the neural recogniser cannot meet a responsive real-time
budget on the measurable runtime; it stays experimental and OFF by default.**
Real GPU hardware would likely be faster, but headless Chromium only exposes
software WebGL, so that cannot be verified tonight.

## 7. CPU / memory

| engine | renderer CPU over ~30 s | JS heap | source |
|---|---|---|---|
| spectral (production) | 5.3 s (~18 % of a core) | 12 MB, no growth | `scripts/measure-mic-resources.mjs` |
| neural (experimental) | 8.7 s (~29 % of one core) | 26 MB | same script |

## 8. Browser acceptance (merged tree)

* `tests/micLiveProduction.test.js` — **5/5**: single note advances, real chord
  completes (V3), V2 fallback completes, partial chord does not advance, room
  noise does not advance.
* `scripts/browser-unified-practice-mic-e2e.mjs` — **22 passed, 1 failed,
  1 skipped**. The single failure is `mic run waits on middle C`: the assertion
  looks for `/middle C|Play C4/` in the score BOX label, but the current UI
  renders the box label as `C4` and puts "Play C4" in the panel. The very next
  checks — "mic correct C4 advances Wait For You" and "turns green" — **pass**.
  This is a stale test assertion, not a recognition defect (and it fails
  identically on untouched main).
* Repeated notes, wrong-note refusal, melody runs, cursor travel, neural
  fallback, permission denial, Play Along and model-unavailable fallback all
  pass.

## 9. Supported and unsupported scenarios (production, measured)

**Supported (today):**
* single piano/guitar notes, mf–ff, repeated notes, open strings;
* dyads/triads/strums **when every tone is independently struck** (main's V3
  chord path; V2 fallback fixed);
* octave chords played as chords (composites: 6/6, zero false completions);
* silence and room noise (never advance).

**Unsupported (documented):**
* an expectation an octave (or a tone) above a note the player is **not**
  playing: guitar ghosts still pass (ghost confidence 0.60 overlaps true
  playing); piano ghosts are now rejected;
* weak bass fundamentals under a strong upper note (model-bound);
* dense sustained chords in the V2 fallback path (gate/confidence limits).

## 10. Integration readiness

Ready to review as a **narrow, additive** change on top of current main:
* two documented constants + one guarded branch in `pianoRecognition.js`;
* 4 new unit tests; no changes to the hook, the chord paths, the cursor or the
  notehead feedback;
* measured on the real browser production path, before/after, with the exact
  commands in this document.

Not ready to deploy: no physical microphone was available, all audio is
injected at the MediaStream boundary; the guitar octave ghost remains; and the
main integration owner must approve (this branch is not merged).

## Commands

```
node scripts/benchmark-production-corpus.mjs --clips mic-accuracy --json out.json
node scripts/benchmark-production-corpus.mjs --clips mic-polyphony
node scripts/benchmark-production-corpus.mjs --clips mic-composites
npx vitest run tests/micPianoRecognition.test.js tests/micLiveProduction.test.js
node scripts/browser-unified-practice-mic-e2e.mjs   # 22 pass, 1 stale label assert
```
