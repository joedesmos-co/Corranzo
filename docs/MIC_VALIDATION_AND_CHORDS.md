# Mic validation on the independent corpus + chord reliability (research branch)

**Date:** 2026-10-24
**Base:** `4a8f8c78e4` on `codex/neural-mic-reliability` (current main merged).
**Method:** real Chromium, real app capture code, real production hook (V3
performance expectations + V2 fallback), real labeled recordings injected at
the MediaStream boundary. No physical microphone was used.

## 0. Benchmark fidelity fix (found during this mission)

The production harness built checkpoints WITHOUT `rollingWindowMs`. The V3
guitar expectation then resolved `windowMs = 1`, so every fresh attack reset
chord accumulation and chords could never complete across a roll. Real app
checkpoints carry a 900 ms chord window (piano/guitar chord defaults), so the
harness now builds them the same way. This **understated chord completion**
in every earlier research measurement (eval 15→18 true), and it is why the
six-string strum looked like an expectation failure when it is really a
detector/bass problem (§3).

## 1. A/B on the independent corpus (mic-real, JAMS/MIDI truth)

Identical clips, identical scenarios, identical harness; only the three mic
files differ (production = current main, research = this branch).

| split | true (production) | true (research) | false scenarios (production) | false (research) |
|---|---|---|---|---|
| dev (18) | 13 | 13 | 5 / 8 | **2 / 8** |
| eval (23) | 18 | 17–18* | — | — |
| eval-fresh (9) | 9 | 9 | 3 / 4 | **1 / 4** |
| **total** | **40/50** | **39–40/50** | **8/12** | **3/12 (−62 %)** |

\* piano-schubert-single fluctuates run to run (verified: advances in
repeated runs); it is timing variance, not a rejection (see §2).

Focused single-note matrix (6 real clips, 24 wrong scenarios):

| metric | production | research |
|---|---|---|
| true | 6/6 | **6/6** |
| false | 2–3/24 | **0/24** |
| onset→advance p50 | 59 ms | **59 ms** |

Remaining research false awards are **semitone-neighbour scenarios only**
(electric-eg07-single ×2, acoustic-fresh-ss-single ×1) — the documented
spectral-skirt ambiguity (measured over seven feature domains in the research
log). Octave false awards are gone on both corpora.

## 2. False-rejection audit (mission item 5)

The first research run used a confidence-based branch in the odd-partial
guard (`confidence < 0.5` ⇒ ghost). It false-rejected two legitimate notes:

| clip | expected | dominant | confidence | 1.5f ratio | verdict |
|---|---|---|---|---|---|
| electric-gtechs-low | 41 (F2, electric) | 41 (= expected) | 0.34–0.48 | **0.55–1.14** | vetoed — wrong |
| piano-schubert-single | 48 (C3) | 48 (= expected) | 0.28–0.33 | 0.22–0.38 | vetoed — wrong |

Both have a real fundamental (3.5e-5 / 2.2e-3) but low confidence (weak low
notes), and their 1.5f band is lit by unrelated energy. Confidence is
therefore NOT used: the guard now requires the **physical precondition** that
the lower octave is actually the sounding note (the frame's dominant pitch)
or is independently heard. After the change both clips show **0 guard
firings** and advance, while every octave ghost (whose lower octave IS the
dominant) is still refused.

## 3. Chord reliability: the six-string open-Em strum and weak bass

Measured on the recording (`uiowa-guitar-mf-open-em-strum.wav`), per frame:

| tone | detected frames (2048 FFT) | ratio |
|---|---|---|
| E2 (40) | 0 % | 0.39–0.87 |
| A2 (45) | 3 % | ≤1.84 |
| D3/G3/B3 (50/55/59) | 33–36 % | ≤4.1 |
| E4 (64) | 4 % | ≤1.88 |

The low E never clears the 1.35 detection ratio (0.39–0.87), so the V3
**bass anchor** can never be satisfied; five of six tones accumulate
(verified in the real path), the chord correctly does not advance. Longer
analysis windows (4096/8192) make it worse (0 % for E2). A deep-bass
confidence relief (0.28→0.24) was implemented, measured to be useless here
(ratio-bound, not confidence-bound) and **removed**.

Relaxing the bass anchor for ≥5-note expectations was rejected: a wrong
six-note chord containing five expected tones is exactly the false-award
family this work removes. The strum and the open E2+E4 dyad remain
**detector-bound limitations** (the low E fundamental is masked by the
higher strings in these recordings).

## 4. Latency, CPU, memory, dropped windows

| metric | spectral (production) | neural (off) |
|---|---|---|
| onset→advance | **p50 59 ms** (30–106 ms on the matrix; chord p50 ~90–145 ms) | 1.79 s (main's measurement) |
| renderer CPU / 30 s | 4.4 s (≈15 % of one core) | 9.5 s (≈32 %) |
| JS heap | 15 MB | 21 MB |
| inference | — | **257 ms / 0.5 s window** (2.3× the 250 ms hop) |
| dropped windows | none | 75 % (main's live run) |

The new evidence costs one extra Goertzel per scored note (no measurable
change; the spectral CPU figure is the same as before within noise).

## 5. Browser acceptance

* `tests/micLiveProduction.test.js` — **5/5**.
* `scripts/browser-unified-practice-mic-e2e.mjs` — **23 passed / 0 failed /
  1 skipped**.
* Full suite — see the commit message.

## 6. Supported / unsupported (current)

**Supported:** single piano/guitar/electric notes (incl. quiet and low),
repeated notes, dyads/triads/strums where each tone is detectable, octave
chords, silence/noise refusal, wrong-note refusal.

**Unsupported (measured):**
* an expectation an octave above a note that is also sounding and not itself
  expected — refused by design (safe direction);
* six-string strum / E2+E4 dyad when the low E fundamental is masked
  (ratio < 1.35 in every frame);
* semitone-neighbour expectations lit by the played note's spectral skirt;
* dense piano passages where expected tones are masked.

## 7. Integration readiness

Additive, mic-owned, no UI/cursor/score-following changes. Evidence and
decision are separate modules (`v2/scoreInformedChordScorer.js` feature →
`v3/octaveGhostEvidence.js` rule), shared by both piano and guitar
recognisers, so a future backend can supply the same evidence.

Not merged, not deployed. Physical acceptance is required and is specified
in `docs/MIC_PHYSICAL_ACCEPTANCE.md`.

---

## Independent reproduction on current production (2026-10-24)

The A/B above was reproduced from current `main` (`a58b60e069`) with the
branch’s corrected checkpoint harness on the same 46 non-excluded mic-real
clips and the same 52 wrong-expectation scenarios.

| metric | production | candidate |
|---|---:|---:|
| legitimate completions | **40 / 46** | **40 / 46** |
| false completions | **22 / 52** | **7 / 52** |
| false reduction | — | **−68 %** |
| onset→advance p50 | 50–62 ms | 62 ms |

The legitimate set is at parity. The two movements between the sets were:

* `piano-mozart2-triad`: production did not complete; candidate did.
* `acoustic-rock-single`: production completed only at ~21.7 s (near the
  harness timeout); candidate did not. A focused run shows the candidate’s
  frames are rejected as `non-musical-input`, not by the new octave guard.
  This is a borderline detection/timing flake, not a guard false rejection.

Focused false-rejection checks:

* `piano-schubert-single` (C3, confidence 0.28–0.33 in earlier research):
  candidate advances, `matched [48]`, `wrong 0`.
* `acoustic-rock-single`: candidate does not advance, but the rejections are
  `non-musical-input` (dominant moved to another melody note), not the
  odd-partial/dominant guard.

Remaining false awards in the 52-scenario matrix are mostly semitone
neighbours and chord “same-count” substitutions; the guitar octave-ghost
family is gone. The six-string open-Em strum still does not complete (the low
E fundamental never clears the detector ratio), on both revisions.

Focused 23-scenario matrix (current main, integrated):

| metric | production | integrated |
|---|---:|---:|
| legitimate completions | 6 / 7 | **6 / 7** |
| false completions | 4–6 / 16 | **1 / 16** |

The one false award left is the guitar open-strum vs octave-transposed chord
(chords are deliberately untouched by this guard). Wrong-note reports are
higher while a wrong octave is held (the guard re-fires per frame); this is
feedback noise, not a false acceptance, and is recorded as a UX limitation.
