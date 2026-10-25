# Mic resolution evidence + robustness (research branch)

**Date:** 2026-10-24
**Base:** current `main` @ `ca85b1468f` merged (main already carries the
October 24 octave-evidence improvement). Delta vs main is mic-owned only.

## 1. Baseline vs candidate (identical recordings, scenarios, harness)

Real Chromium production hook (V3 + V2), MediaStream injection, mic-real
JAMS/MIDI truth. "Production" = current main; "candidate" = this branch.

| matrix | production | candidate |
|---|---|---|
| mic-real dev, true | 13/18 | **13/18** |
| mic-real eval, true | 18/23 | **17–19/23** (timing variance) |
| mic-real fresh, true | 9/9 | **9/9** |
| **true total** | **40/50** | **39–41/50** |
| false (octave+neighbour scenarios) dev | 5/8 | **0/8** |
| false (octave+neighbour scenarios) fresh | 3/4 | **1/4** |
| **false total** | **8/12** | **1/12 (−87 %)** |
| focused single-note matrix (6 clips, 24 scenarios) | 6/6 true, 2–3/24 false | **6/6 true, 0–1/24 false** |
| onset→advance p50 | 59–62 ms | **50–66 ms** |

Consistency: accuracy matrix run three times → 0, 1, 0 false; dev false
sweep run twice → 0/8 both. The remaining fresh false award is one clip
(§3). Every octave false award is gone.

## 2. The new method: semitone-resolution evidence

A short analysis window (2048 samples, 46 ms) has a wide spectral main
lobe, so a played note leaks into the semitone above/below — the last
false-award family. A longer window narrows it. Measured on the real FP
clips at **8192 samples (186 ms)**:

| clip | true pitch (long ratio) | neighbour-1 | neighbour+1 |
|---|---|---|---|
| electric-eg07 (55 played) | 3.06 | **1.42** | **1.19** |
| acoustic-fresh-ss (56 played) | 5.81 | 2.35 | 2.05 |

The detector floor is 1.35: the electric neighbours fall **below** it while
the true note stays detected. Implemented as evidence, not a threshold
change:

* **detection layer** (`v2/scoreInformedChordScorer.measureResolutionRatios`):
  for a single-note expectation, measure the expected pitch and its two
  semitone neighbours in one 8192-sample Hann window (same noise floor).
* **expectation layer** (`v3/octaveGhostEvidence.semitoneLeakFromResolution`):
  refuse when the expected pitch is **below the existing 1.35 floor at
  resolution** AND a semitone neighbour is **≥1.8× stronger**.
* Wired through the v2 tick (`frame.resolutionEvidence`) into both the
  piano and guitar recognisers' unexpected-tone rules.

Safety argument (measured): a real note keeps a long-window ratio ≥2.29 on
every true single-note case except `acoustic-rock-single` (0.74 — a clip
that is already undetectable and never completes); the rule does not apply
to chords or octave relations; it never lowers a completion threshold.

## 3. Rejected experiments (this mission)

* **Global 8192 detection window** — loses `acoustic-rock-single` and smears
  strums/rolls (the earlier FFT sweep: mid-string detection 33–36 % → 19–26 %).
* **Neighbour-dominance (max ±1 / expected)** — false-rejects true notes:
  funk-single 0.63, gtechs-low 0.88, rock-single 0.26 (the low E string
  rings sympathetically under the played note).
* **Monophonic-dominant comparison** — the monophonic estimate on the
  electric clip reads 58.1 for a played 55 (three semitones off), so it
  cannot anchor the comparison; the neighbour scan replaced it.
* **Reducing the 1.8 factor** — would reject funk-single (neighbour 1.58×
  stronger), which is a legitimate completion.

## 4. Remaining false award (documented ambiguity)

`acoustic-fresh-ss-single`: expectation 55 while 56 is played. The
expected pitch's long-window ratio is 2.35 (above the floor), so the
resolution rule correctly declines to veto. Separating it would require a
dominance factor ≤1.5, which false-rejects a true note on another clip.
Mono-microphone evidence cannot separate this case safely; the engine
refuses on the safer side everywhere else.

## 5. Chords and low fundamentals (measured, no unsafe change)

* Six-string open-Em strum: E2 detection ratio 0.39–0.87 in every frame
  (floor 1.35); longer windows make it worse (1.66→1.15→0.64). Five of six
  tones accumulate; the V3 bass anchor correctly blocks completion.
* E2+E4 dyad: same masking (0.16–0.65).
* A deep-bass confidence relief was measured useless (ratio-bound) and is
  not shipped. Relaxing the bass anchor for ≥5-note chords was rejected
  (it would complete wrong chords that share five tones).
* Octave chords, rolled octaves, repeats and legato: unchanged, all pass
  (true sweep).

## 6. Real-time cost (measured)

| metric | value |
|---|---|
| tick cost, single-note expectation with resolution evidence | **1.38 ms/frame** (1.17 ms without; +0.21 ms ≈ 1.3 % of one core) |
| onset→advance p50 | **50–66 ms** (worst observed 106–194 ms) |
| dropped inference windows | none (2048-sample FFT at the 60 Hz cadence) |
| renderer CPU / 30 s | ~4.4 s (~15 % of one core) |
| JS heap | 15 MB |
| neural engine | OFF (257 ms per 0.5 s window; 2.3× the hop) |

## 7. Browser acceptance

* `tests/micLiveProduction.test.js` — **5/5** (single note, V3 chord, V2
  fallback chord, partial chord refused, room noise refused).
* `scripts/browser-unified-practice-mic-e2e.mjs` — **23 passed / 0 failed /
  1 skipped**.
* Full suite — see the commit message.

## 8. Integration readiness

Additive, mic-owned; evidence and decision remain separate modules shared by
piano and guitar; the V3 decision logic and V2 fallback are untouched; no UI,
cursor or score-following changes. The physical acceptance checklist is
preserved at `docs/MIC_PHYSICAL_ACCEPTANCE.md` (no hardware was available;
every number here is injected-stream). Not merged, not deployed.

---

## Independent reproduction on current production (2026-10-24)

Reproduced from current `main` (`ca85b1468f`) with the same harness, real
Chromium production hook and identical clips/scenarios. Production already
contains the October 24 odd-partial octave guard.

| matrix | production | candidate |
|---|---:|---:|
| legitimate completions (46 clips) | **40 / 46** | **39 / 46** |
| onset→advance p50 | 50 ms | 63 ms |
| octave+neighbour false scenarios (8 clips, 21 scenarios) | **12 / 21** | **1 / 21** |
| remaining false | — | `acoustic-fresh-ss-single:neighbor-1-of-56` |

The only true-completion difference is `acoustic-rock-single`: production
advanced at ~21.7 s (near the harness timeout), candidate did not. That clip is
already an inconsistent/borderline detector case; the candidate's other 39
legitimate completions, including quiet electric, repeats, chords and octave
composites, are at parity.

The remaining false award is the documented case: expectation 55 while 56 is
played; the expected long-window ratio is above the floor, so a safe veto would
require rejecting true notes elsewhere.

Independent cost measurement of `measureResolutionRatios` in Node on an 8192-
sample window: **1.09 ms/call** over 1,000 calls (well below a 16.7 ms frame
budget; the research browser measurement was 0.21 ms incremental). It runs only
for single-note expectations.
