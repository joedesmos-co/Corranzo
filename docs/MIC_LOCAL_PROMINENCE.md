# Local chord-tone prominence and attack-window evidence (recall round)

**Date:** 2026-10-28
**Start:** `42baa9ccb1` (repeated-attack fix; 40/54 sequence, 0 false/early).
**Goal:** improve correct chord recall without lowering global thresholds, adding
false advancement, or skipping repeated attacks.

## 1. Miss classification (traced, existing data only)

The 14 baseline misses split into four acoustic/application causes:

| cause | examples | evidence |
|---|---|---|
| **Quiet chord tone below the global 2048 noise floor** | UIowa C-major E4; UIowa C4+E4 E4; UIowa Cmaj7 E4/C4 | E4 fundamental 0.0065 vs global floor 0.0080 at 2048; ratio 0.8–1.3. At 8192 the E4 is a 21–81× local peak. |
| **Inaudible/absent expected tone in a construction-truth composite** | UIowa open-Em E2 (and several strings) | at 8192 E2 m ≈ 0.00003–0.00014 while G3/B3 ≈ 0.005–0.03; no independent local peak. |
| **Quiet/dense natural excerpt or closed gate** | Vienna Mozart second triad | rms 0.002–0.010, gate closed; only E4 reaches the normal floor; no safe multi-tone evidence. |
| **Fast repeated guitar chords vs confirmation budget** | GuitarSet power dyad at 0.24/0.50/0.95/1.25 s | first attack confirms in 166 ms; next attack is 71 ms later; the 450 ms continuation is inside the same stale/rearm window. A 2.2 s repeated-dyad control passes 313–329 ms. |

The GuitarSet jazz F3 is **not** an acoustic miss: the production
single-checkpoint replay advances at 83 ms and the note reads V2 confidence
0.9 / ratio 5.2. In the multi-checkpoint harness it is intermittently rejected
as `non-musical-input` during the attack/decay and the attack latch can remain
armed across the intervening non-target notes. That is an
application/lifecycle/classifier interaction, not a missing pitch; no
production override was added in this round (a candidate override was measured
and reverted because it did not make the sequence deterministic).

## 2. New evidence: local prominence at 8192

For an undetected expected chord tone, the scorer now probes the last 8192
samples (186 ms) and requires:

1. at least one **other expected tone strongly detected** in the same frame
   (`ratio ≥ 1.6`, `confidence ≥ 0.3`);
2. fundamental magnitude `≥ 0.0007` (measured true Schubert A3 0.00081;
   false-family maxima 0.00004–0.00013);
3. local prominence `m / median(±0.5..2.5 semitone probes) ≥ 6`;
4. local peak `m / max(nearby probes) ≥ 1.3`;
5. no integer-harmonic relationship to a strong peer;
6. no strong subharmonic at f/2, f/3, f/4 (octave/ghost guard);
7. not already vetoed as a deep-bass/high-lower-octave artifact.

The expected score selects the probe target only; the decision requires the
independent local spectral peak and the harmonic/subharmonic guards. It does
not scan blind pitches and does not lower the normal detection thresholds.

Measured features (8192, 400 ms unless noted):

| case | local prominence | peak ratio | rescued? |
|---|---|---|---|
| UIowa C triad E4 (true) | 21.7 | 13.0 | **yes** |
| UIowa C4+E4 E4 (true) | 39.5 | 16.8 | **yes** |
| UIowa Cmaj7 E4 (true) | 24.3 | 11.6 | **yes** |
| UIowa Cmaj7 B4 (true, 200 ms) | 12.6 | 1.68 | **yes** (normally detected too) |
| C triad expecting Cmaj7 B4 (false) | 0.8–1.2 | 0.02–0.33 | no |
| C4 single expecting E4 (false) | 0.8–1.2 | 0.20–0.39 | no |
| C4+G4 expecting E4 (false) | 0.6–2.0 | 0.03–0.10 | no |
| transposed jazz dyad (false) | 1.0–1.7 | 0.05–0.54 | no |
| eg08 transposed triad (false) | 0.2–0.7 | 0.02–0.32 | no |
| noise (false) | 1.0–1.2 | 0.49–0.53 | no |
| C5 over C4 (octave ghost) | 288 | 40 | **blocked** (C4 subharmonic) |

A frame-level sweep of every `mic-real` clip and all generated wrong
expectations found **0 rescue-only false completions**; the 8 frame-level false
detections that did occur were already produced by the normal detector
(dense/late notes), not by the rescue. Lowering the local floor/peer bar from
0.001/1.8/0.5 to 0.0007/1.6/0.3 raised true frame completions 28→30/49 and
left the 8 normal/0 rescue-only false result unchanged.

The natural Vienna Schubert triad A3 is a genuine local peak (7.9×) rescued
offline; its full live single-checkpoint replay still misses because the dense
clip emits four wrong-tone reports and the expectation layer rejects them. That
is a dense-performance/application interaction, not a missing local peak, and
no threshold was lowered to force it.

## 3. Attack-window invariant

While testing the rescue, a pre-existing late ghost appeared: the UIowa
C-major triad replayed against Cmaj7 produced a false B4 relief 1.2 s after
the attack while C/G still rang; the Cmaj7 expectation then completed even
though B4 was never struck. The sustained-note window (1600 ms) had been reused
for **new** chord-tone evidence.

The V3 piano/guitar recognition now keeps two windows:

* **sustain/ring window** — how long already-matched notes may persist;
* **attack window** — `max(rollToleranceMs, rollingWindowMs)` — the only period
  in which a **new** pitch may be added.

A physically depressed sustain pedal (`pending sustainPedalDown`) still allows
later notes of an arpeggiated/pedaled chord, preserving the existing pedal
behavior. A score note's nominal duration alone no longer permits late ghosts.
The bounded attack window is **chord-only**: a single-note checkpoint keeps
the prior sustained-note behavior, because there is no chord-tone accumulation
to protect (the full-app sustained-C4 probe exposed this distinction). This is
the safety fix that lets the local rescue be used without turning a partial
chord into a completed wrong chord.

## 4. Result

Affected UIowa/piano controls, 3 repeated browser-injection runs each:

| scenario | before | after |
|---|---|---|
| UIowa C triad sustain + holds | 2/3 (attack missed) | **3/3**, 193–208 ms |
| UIowa C triad repeated ×2 | 1/3 | **3/3**, 187–207 ms |
| piano C4+E4 repeated + hold | 1/3 | **3/3**, 210–221 ms |
| guitar repeated dyad + hold | 3/3 | **3/3**, 309–361 ms |
| partial C-triad-negative (expect Cmaj7) | 1/1 | **1/1** (no false B4) |

Full sequence matrix after the change: **47/54 passed, 0 false advances,
0 early advances, 7 missed** (two final runs; p50 56 ms, p95 266 ms; rescued
chords 184–224 ms). The verified minimum gain is the five UIowa/dyad steps
(40 → ≥45); the two jazz F3 steps pass intermittently, so the conservative
floor is 45/54. The affected UIowa/dyad group passed 3/3 in three repeated
runs.

Production single-checkpoint baseline remains **6/6 true, 0/24 false**,
p50 56 ms / p95 89 ms. Remaining sequence misses: open-Em composite (E2
measured at 0.00003–0.00014 vs 0.005–0.03 for G3/B3 — absent in the
construction-truth recording), Mozart second triad (quiet/closed gate), and
the 450 ms power-chord stress (tempo exceeds the chord confirmation budget).
These are not safe threshold opportunities.

## 5. Cost

Measured `scoreInformedChordWindow` on an incomplete UIowa chord frame:
**0.449 ms without / 0.653 ms with** the rescue (adds ~0.20 ms/frame). It only
runs for incomplete chords with a strong peer; complete chords and single
notes pay nothing.

## 6. Decision

The local-prominence rescue and the attack-window invariant are verified
recall/safety changes. Keep them. Do not lower the global detection floor or
add a score-note-only prior for the remaining misses. Per-string/DI or physical
recordings remain the next evidence source.
