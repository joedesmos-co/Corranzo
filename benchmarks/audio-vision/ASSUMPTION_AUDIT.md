# M1 — Audio assumption audit (measured, not assumed)

Every item below was **reproduced and measured** with
`scripts/audio-vision-assumption-probe.mjs` (tempo/gain/melody) and
`scripts/audio-vision-invariance.mjs` (format/condition controls) on real
corpus audio, then fixed where the evidence justified it. "Dangerous" means the
pipeline produced a materially wrong result for normal input; "intentional"
means a documented V1 product limit.

## Found and FIXED

| Assumption | Measured failure | Fix |
|---|---|---|
| Tempo ceiling 200 BPM, octave corrected by a fixed pocket (`>170` halves) | A 202 BPM recording reported **99 BPM** — every duration then written twice as long | Search range raised to 240 BPM; halving now only fires *above* the searched range. Verified: 86→86, 101→103, **202→199**, slow→double-time pulse |
| Melody band fixed at 180–1400 Hz | **643/2883 (22%)** of TRIOS viola frames and 955/3186 (27%) of violin frames peak above 1400 Hz — those moments were invisible to the melody detector | Widened to 130–3500 Hz (bass band untouched). Verified: viola now covers **10/10** distinct truth pitches, violin **20/20** |
| Silence gate at absolute RMS 0.002 | Refused a real recording at **−40 dB** (post-normalization RMS 1.1e-3) | Replaced: RMS now only catches digital silence (≥1e-5), and a **structural gate** after analysis refuses when there are no onsets and no melody frames. Measured separation: quiet music at −40 dB yields 226 onsets; noise and digital silence yield 0 |

## Measured and ACCEPTED (documented V1 limits)

| Assumption | Evidence | Why accepted |
|---|---|---|
| Material genuinely slower than ~90 BPM is reported at its double-time pulse | A 43 BPM excerpt reads 74 BPM (the octave reading is in `octaveAlternative`) | The doubling rule is what fixes the much more common case of a 120 BPM pulse reading 60; removing it broke that. Documented rather than hidden, and the alternative reading is always returned |
| 4/4 meter assumed for measure grouping | `arrangeSoloPiano`/`emitGrandStaffMeasure` use `beatsPerMeasure = 4` | Odd meters were never in V1 scope; the beat grid itself is tempo-derived, so note placement stays correct — only measure numbering assumes 4/4 |
| 3-minute analysis excerpt | `EXCERPT_MAX_SECONDS = 180`, surfaced to the user in the excerpt selector and the review banner | Explicit product limit, user-visible by design |
| Analysis rate fixed at 22050 Hz mono | Import normalizes everything to 22050 mono (peak-normalized, gain ≤10×) | Verified format-invariant below |

## Cross-condition invariance (one recording, controlled transforms)

| Variant | Notes extracted | Tempo | Notes vs baseline |
|---|---|---|---|
| baseline | 221 | 86 | 1.000 |
| gain +6 dB / +12 dB | 221 | 86 | **1.000** |
| mono↔stereo duplicate | 221 | 86 | **1.000** |
| leading silence +2 s | 220 | 86 | 0.814 |
| mild pink noise (~40 dB SNR) | 164 | 86 | 0.719 |
| mis-declared 48 kHz | 190 | 92 | 0.009 |

Notes: gain and channel handling are **exactly** invariant (peak normalization
works). Leading silence costs ~19% of notes because the beat anchor shifts with
the pad — a known, recoverable axis, not a format problem. The 48 kHz row is a
*lying decoder* control (the audio genuinely plays 8.8% faster when the rate is
mis-declared), so it is not evidence of a defect; real Web Audio decoders report
the true rate. Noise degrades as physics dictates. **Transformed variants are
controls, not independent performances** — all generalization claims come from
the 16 independent labeled recordings.
