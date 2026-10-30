# Blind played-pitch detection — feasibility and stop decision

**Date:** 2026-10-25
**Start:** `df5f0f40f9` (+ current `main` merged). **End:** analysis only —
no production change. **Stop rule invoked** (Phase 6): blind multipitch
detection cannot identify played notes reliably enough for score comparison.

## 1. Phase 1 — the scan and its real cost

Prototype: MIDI 21–108 Goertzel bank over the 2048-sample detection window,
harmonic sum (f0 + 0.5·2f0 + 0.33·3f0), peaks normalized by the median band
magnitude. Measured with `process.cpuUsage` over 110 frames per clip
(warmup excluded), not estimated:

| clip | frames | wall | CPU | per frame | peaks/frame |
|---|---|---|---|---|---|
| real-c-major-triad | 110 | 120 ms | 121 ms | **1.10 ms** | 13.5 |
| real-piano-c4 | 110 | 119 ms | 119 ms | **1.08 ms** | 10.1 |

The earlier ~1 ms/frame figure is confirmed. At 60 fps this is ≈6.6 % of one
core — acceptable in principle.

## 2. Phase 2 — observability vs recorded truth

Pitch-set accuracy at the chord sustain (anchor + 250 ms), 2048 window,
peak threshold 2.0× the median band:

| case | truth set | blind set | precision | recall | octave errors |
|---|---|---|---|---|---|
| TRUE dyad (jazz-dyad) | 50,55,58,59,60,61 | 60,48,41,72,37,39,53,31,56 | **0.11** | **0.17** | 48,72 |
| FP scenario (same audio) | same | **identical set** | 0.11 | 0.17 | 48,72 |
| TRUE triad (eg08) | 47,58,71,72 | 59,47,72,40,53,70,36,51 | 0.25 | 0.50 | 59,70 |
| piano triad | 60,64,67 | 16 peaks | 0.19 | 1.00 | 48,52,72,55,76,79 |
| power dyad | 49,56,59,61 | 56,44,37,47,53,59,34,32,41,26 | 0.20 | 0.50 | 44,37,47 |
| guitar strum | 10 tones | 43,59,47,62,55,67,50,29,35,31,71 | 0.45 | 0.50 | 47,62,31,71 |
| single note (gtechs-mid) | 57 | 15 peaks | **0.07** | 1.00 | 45,69 |

Findings:
1. **The blind set is dominated by harmonics** (10–16 peaks/frame; precision
   0.07–0.45). A single played note yields 15 candidates.
2. **The FP and TRUE dyad scenarios are indistinguishable by construction**:
   the audio is the same recording; only the expectation differs. The blind
   set contains 60 (played) and the harmonic 72, and it *misses the true
   dyad's own bass 50* — recall for genuine chord tones is 0.17–0.5.
3. A score-aware rule "the expected pitch must appear in the blind set"
   would therefore **reject the true dyad and the true triad as readily as
   the false ones** — it is not a viable safety guard.

The mission's own caution applies exactly: *a blind detector that frequently
misidentifies harmonics must not be treated as an authoritative source.*

## 3. Phase 3–5 — not reached

Score comparison, false-advance testing and browser feasibility would rest
on an authoritative played-pitch estimate. With precision 0.07–0.45 and
recall 0.11–0.5 on genuine chords, any comparison threshold either accepts
the false families or rejects legitimate chords. No candidate was built; no
latency trade was made.

## 4. Decision (stop rule)

**Stop this line of research. Production remains unchanged.** Independent
mono-microphone played-pitch estimation at ~1 ms/frame is affordable but not
observable enough: the played chord's own tones are missed as often as the
harmonics are invented, so it cannot arbitrate between an expected chord and
its transposition.

## 5. Evidence-backed alternative directions

1. **Better independent recordings** — close-miked, per-string or per-note
   material (e.g. a DI/close-mic dataset with isolated string recordings)
   would give the blind estimator a fair chance; the current fixtures are
   mixed mono performances where body resonance and harmonics dominate.
2. **Instrument-specific recognition** — guitar string/fret priors
   (tuning, open strings, fretboard constraints) could constrain the blind
   set far more than a generic pitch scan; this needs a labelled
   per-string corpus.
3. **Physical acceptance testing** — the open-Em/low-E and ghost structure
   may differ on real hardware; the acceptance checklist already covers
   them.
4. **Product-side honesty** — keep the documented supported range (single
   notes, struck chords, octave chords) and the transposition warning as a
   UI *hint* only if blind detection ever becomes reliable.

## 6. Resources

Blind scan CPU measured at 1.1 ms/frame (≈6.6 % of a core at 60 fps); no
production code changed; no datasets modified.
