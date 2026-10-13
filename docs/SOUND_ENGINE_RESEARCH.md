# Sound Engine Research — Playback Realism (Piano & Guitar)

Branch: `codex/notation-aware-audio`

Workstreams on this branch:

| Commit | Workstream |
|---|---|
| `87c61a40f2` | real bends/slides/vibrato, ornaments, deterministic room, fermata sync proof |
| `920cf44874` | widened piano dynamics + frozen playback acceptance set |
| (this work) | M1 sample-licence rescue, M2 brightness-band root cause, M3–M6 |

This document records what was **measured**, what was **changed**, and what
was **rejected on evidence**. It deliberately stops short of claiming the
result sounds like a real instrument — see §10, Remaining listening
limitations.

---

## 1. Verified branch and commits

```
$ git -C ~/Documents/scoreflow-sound-engine status
On branch codex/notation-aware-audio
nothing to commit, working tree clean

$ git worktree list | grep sound-engine
/Users/ryland/Documents/scoreflow-sound-engine  920cf44874 [codex/notation-aware-audio]
```

`main` is checked out in `~/Documents/scoreflow` at `fcdb8d0172` and was
never modified. No new worktree was created and no other agent's worktree
was touched.

**Relation to the integrated preview.** `920cf44874` is an ancestor of
`origin/codex/unified-practice-audio-preview`. `git diff` of
`src/features/playback` between the two is empty except for this
workstream's changes — the playback code here is the same as the integrated
preview, so nothing was blindly merged and no playback work was duplicated.

---

## 2. Sound-engine architecture

```
scorePlaybackSchedule.js   score → performed events (velocity, duration,
                           technique curves, ornaments, strums)
scorePlaybackEngine.js     transport: windowed scheduling, metronome,
                           seek/pause/stop, instrument switching
        ↓
sampledInstrumentVoice.js  shared voice: synth-first fallback, lazy
                           sampler(s), shared decoded-buffer cache, FX
                           chain, voice-mix ducking, per-note technique
                           sources
        ↓
pianoInstrument.js         Salamander sample set + piano timbre/volumes
guitarInstrument.js        Iowa acoustic guitar set + plucked fallback
electricGuitarInstrument.js CC0 Emilyguitar set + clean-electric fallback
```

Verified in code, not assumed:

- **Synth fallback sounds immediately** — the oscillator/pluck voice is
  wired before samples decode, so the first note always makes sound and the
  Safari/iPad "unlock on first tap" path keeps working.
- **Decoded buffers are shared per base URL**, so re-created voices
  (seek/loop flush) never re-fetch. Pinned by
  `tests/playbackInstrument.test.js`: a second voice adds samplers and zero
  buffer fetches.
- **Voice-mix ducking** only kicks in above 8 simultaneous voices, so
  realistic piano density is unducked.
- **Technique notes** (bend, release, slide, vibrato, slur) bypass the
  sampler for a per-note `ToneBufferSource` — the only way one chord tone
  can move pitch independently.

---

## 3. Sample and licence audit (M1)

### Final status

| Asset | Source (verified upstream) | Licence | Attribution required |
|---|---|---|---|
| Salamander Grand Piano (Yamaha C5) | `sfzinstruments/SalamanderGrandPiano` | **CC-BY-3.0** | **Yes** (given) |
| Acoustic guitar | University of Iowa EMS (Lawrence Fritts) | **No restriction** — "may be downloaded and used for any projects, without restrictions" | No |
| Clean electric guitar | **"Emilyguitar"**, Karoryfer Lecolds (D. Smolken, 2014) | **CC0-1.0** | No (credited as courtesy) |

### What was wrong, and why the wrapper's claim did not settle it

The previous clean-electric entry credited `nbrosowsky/tonejs-instruments`
as "CC-BY-3.0". That is the **wrapper repository's** licence claim for its
own samples. The wrapper's own `sample-source-info.txt` says:

```
guitar el   - Karoryfer
```

So the actual originating owner is **Karoryfer** — a commercial sample
vendor whose own catalogue page is a paid shop. A wrapper's blanket CC-BY
statement does not override the originating owner's terms, so the clean
electric set could not be cleared on that evidence.

### Evidence chain for the replacement

1. `github.com/sfzinstruments/karoryfer.emilyguitar` — tagged
   **CC0-1.0** by GitHub, and the repo's `LICENSE` file is the full
   **CC0 1.0 Universal** legal text (opt-out of copyright, waiver of all
   rights including commercial).
2. The repo's `readme.txt`: *"Epiphone Emily the Strange guitar played and
   mapped by D. Smolken… **Royalty-free for all commercial and
   non-commercial use.** Copyright 2014 Karoryfer Lecolds."* It describes
   the samples as *"recorded direct, using both pickups and all knobs on
   ten"* — a clean electric tone, exactly what the voice documents.
3. Karoryfer's own announcement on KVRDC (Nov 2022): *"All our freebies are
   now CC-0 instead of some being CC-BY and some CC-0."*
4. `sfzinstruments.github.io/guitars/` lists Emilyguitar as **CC0-1.0**,
   while the same page marks Glockenskull Guitar, Secret Agent Guitar,
   Snowkiss Guitar and Surfkiss as **Commercial** — Karoryfer's commercial
   guitars are clearly distinguished from the free ones.
5. Independent corroboration from third parties that undertook their own
   provenance: muted.io (*"the electric guitar samples are originally from
   Karoryfer Samples, licensed under CC BY 4.0"*), melognite.app
   (*"Karoryfer Free-Libs | CC0"*), loopingguitar.com (Karoryfer Lecolds,
   CC0 1.0).

**Commercial redistribution:** CC0 waives the exclusive rights including
commercial ones, so redistribution in a product is permitted, and no
attribution obligation exists. Attribution is given anyway as courtesy.

**What was NOT done:** no commercial or paid library was downloaded; no
large set was fetched (17 single notes, ≈9.1 MB of WAV, transcoded down to
1.7 MB of mp3 — the same footprint the previous set occupied); the previous
samples were **not deleted from history**, only replaced in the working
tree.

### Replacement mechanics

- All 17 keys of `ELECTRIC_GUITAR_SAMPLE_URLS` map exactly onto Emilyguitar
  pitches (`Cs2→db2`, `Fs2→gb2`, `Ds3→eb3`, …), and the bundled filenames
  were left unchanged, so no code map change was needed.
- Downloaded the `mf` velocity layer, transcoded to 192 kbps mono mp3 via
  ffmpeg (identical size to the files replaced: 102861 vs 102696 bytes).
- **The CDN fallback was removed.** `getElectricGuitarSampleFallbackBaseUrl()`
  now returns `null`. This is load-bearing rather than tidying: the old
  fallback pointed at the tonejs-instruments set, so a same-origin load
  failure would have silently re-introduced the unverified samples. With no
  fallback the voice stays on its synthesised plucked tone and reports
  `SYNTH` status honestly.
- `SOUND_CREDITS` in `legalInfo.js` was rewritten as a provenance record
  (`verifiedFrom` + `attributionRequired` per entry) and is now **rendered
  by** `TermsOfServicePage`, removing the two-sources-of-truth drift
  documented in the previous workstream.

### New defect found while verifying: top-octave Salamander keys are sharp

`tests/samplePitchCoverage.test.js` measures every mapped file through the
app's own decode path. Mid-register keys are within +23 cents, but:

- **`A7` measures ~+30 cents, `C8` measures ~+91 cents** (a semitone),
  consistently across three independent analysis windows.
- Both files are **byte-identical (md5) to
  `tonejs.github.io/audio/salamander/`**, so the project did not introduce
  this and cannot fix it without re-sourcing (the full set is 394 MB).
- **Playback consequence:** `Sampler` pitch-shifts each played note from
  the nearest sample by an exact semitone count, so anything derived from
  C8 — B7 and every note above it — sounds a semitone sharp.

The test pins this as a **characterisation**: only these two keys are
allowed to be off, and the exact key set is asserted, so a new mislabel
(the octave errors an earlier guitar-acoustic audit found) fails the suite
while the known upstream defect does not mask it.

---

## 4. Piano playback — what changed

### Dynamic range widened (previous workstream, re-verified)

`mapPlaybackVelocity` exponent 1.22 → 1.7 (floor 0.12 preserved so every
existing ordering assertion still holds). Measured through the real engine
path:

| Curve | pp gain | ff gain | pp→ff span | Monotonic | Peak at ff |
|---|---|---|---|---|---|
| before | 0.203 | 0.920 | **12.0 dB** | yes | 0.0853 |
| after | 0.167 | 0.918 | **16.3 dB** | yes | 0.0851 |

The floor is now the binding constraint rather than the exponent: raw
velocity 0.20 already clamps at 0.12, so further widening needs
`MIN_TRIGGER_VELOCITY` lowered too, which is a product decision about how
quiet pp may go rather than a measurement.

### Everything else — measured, left alone

- **Attack:** sampler `attack: 0.008 s` (soft enough not to click).
- **Decay / release:** audible length 1.91 s with the 1.85 s tail; the tail
  decays to true silence by the end of a render (tail energy 0.0).
- **Repeated notes:** 4 repeated A4s → exactly 4 detected attacks, 0
  duplicates skipped.
- **Chords / polyphony:** 9-note fff chord peaks at 0.335 against a 0.671
  limiter ceiling, with **0 clipped samples and 0 voices stolen**.
- **Overlapping notes:** see §6b — no truncation.
- **Register consistency:** the top-octave sharpness in §3 is the live
  defect; nothing else off-pitch in the 30-key set.

### Velocity layers — not available, and why

`velocityLayers: 2` has always been **reported in diagnostics but never
implemented**: Tone's `Sampler` maps one buffer per note name and uses
velocity purely as source gain, so a real velocity layer requires one
sampler per layer and per-velocity routing. The bundled Salamander "lite"
set is a single-layer subset (the full set is 394 MB, explicitly out of
scope), so even with the routing in place there is nothing to route to.

This is the next milestone (§11), and M2 below retired most of its risk.

---

## 5. Guitar playback

- **Acoustic (Iowa):** plucked decay ratio early/late **7.14×** — a note
  is clearly decaying well inside its own written span. 31 samples load, 0
  missing. 6-string strum peaks at 0.465, 0 clipped samples. No defect
  found that a small safe change would fix, so nothing was changed.
- **Electric (now CC0):** all 17 keys verified in pitch through the app's
  own decode path. Only a **clean** tone is provided; crunch and distortion
  remain documented as unsupported. The high-register degradation
  previously disclosed (missing E3/E4/E5/G/B keys pitch-shifting from
  neighbours) no longer applies to the same extent because the new set's
  pitches line up with the map exactly, but it is still worth a listening
  check.
- Playback of the electric voice is unchanged in behaviour; only the
  underlying samples and their provenance differ.

---

## 6. Rejected on evidence (recorded so it is not retried blindly)

### 6a. Per-velocity brightness bands — cause found, approach rejected (M2)

**Hypothesis (from the previous workstream).** The voice routes the whole
polyphonic sampler through ONE lowpass re-aimed at each note's onset, so
the note triggered last wins. A loud note drags every still-ringing soft
note bright; a soft note makes a ringing loud note dull. Fix: three filter
bands over the *same* decoded buffers, chosen per note.

**Symptom to explain.** Bands were implemented and wired, and the per-velocity
table came out non-monotonic:

| velocity | 0.44 | 0.45 | 0.46 | 0.50 |
|---|---|---|---|---|
| energy | 3.552 | 3.716 | **3.314** | 3.915 |

Raising velocity from 0.45 to 0.46 made the note **11 % quieter**, and the
crescendo acceptance case failed at the same boundary.

**Isolated measurement.** `scripts/audio-render/sampler-ab.mjs` renders one
note per case with a single variable — same note, time, velocity,
destination, `Tone.Offline`:

```
velocity 0.8
  case                        window energy     peak     vs A
  A primary, no filter             5.301538  0.059081  x1.0000 (+0.0%)
  B secondary, no filter           5.301538  0.059081  x1.0000 (+0.0%)
  C primary, 1000 Hz               6.664877  0.065801  x1.2572 (+25.7%)
  D secondary, 2700 Hz             5.696751  0.060499  x1.0745 (+7.5%)
```

and again, identically, at velocity 0.45.

**What this proves:**

1. **Sampler construction is not the cause.** A and B are *bit-identical*
   (ratio 1.0000). Two samplers built from the same decoded buffers with
   the same volume/release/attack are exactly equal, so the "the band
   samplers are quieter" theory is dead. This is the useful half of the
   answer — it means multiple samplers *are* safe.
2. **A lowpass here ADDS energy.** C and D are both louder than the
   unfiltered A/B. A lowpass cannot add energy unless it resonates.
3. **Narrower cutoff = bigger boost.** 1000 Hz gains +25.7 %, 2700 Hz only
   +7.5 %. Band 0 (the soft band) was therefore boosted *more* than band 1,
   which is exactly the observed inversion.

**Root cause of the boost.** `scripts/audio-render/filter-curve.mjs`
measures Tone's filter with a **matched graph** (identical oscillator →
Filter → Gain → destination, differing only in cutoff, so no structural
difference can masquerade as gain):

```
Tone.Filter — lowpass 1000 Hz, rolloff -12, Q=1 (matched-graph)
   600 Hz  +1.57
   800 Hz  +1.95    <-- peak
  1000 Hz  +1.00
  1300 Hz  -2.62
  2200 Hz  -12.81
  loudest point: 800 Hz at +1.95 dB
```

Tone's `Filter` is a **resonant 2-pole lowpass with a ~+2 dB peak just
below its cutoff** (`rolloff: -12` builds one BiquadFilter, and Tone
defaults `Q` to 1 rather than the Web Audio default 0.707).

For a piano C4 the 3rd and 4th harmonics sit at 785 and 1046 Hz — squarely
on a 1000 Hz cutoff's peak, which is why the soft band took a +25.7 %
energy hit. The loud band's resonance lands near 7700 Hz where the sample
has almost nothing, so it gains almost nothing. The peaks are placed by
the *filter*, so the softer the note, the bigger its resonant boost.

**Why this also matters for the shipped voice.** The live
`samplerToneFilter` is the same resonant Tone.Filter, and
`brightnessHzForVelocity` re-aims it per note (pp ≈ 1315 Hz, ff ≈ 8650 Hz).
So the existing "velocity brightness" mechanism does not only cut highs —
it moves a resonant peak that lands in the note's strong harmonics when
soft and in near-empty territory when loud. That is a real, pre-existing
characteristic of the current design and is documented here rather than
hidden.

**Why the fix was not landed.** The obvious correction is to flatten the
filter. Requested Q does not do it — measured gain with a matched graph
stays above unity even at Q = 0.1:

| requested Q | loudest point |
|---|---|
| 1 (Tone default) | +1.95 dB @ 800 Hz |
| 0.707 | +1.72 dB @ 800 Hz |
| 0.1 | +1.22 dB @ 800 Hz |

Tone's filter gain curve is therefore not characterised well enough to
change safely, and the one tool that could confirm it
(`getFrequencyResponse`) throws in this environment ("out of range
frequency" on the native node). Replacing Tone.Filter with a raw
`BiquadFilterNode` in the live chain would change production audio on a
hypothesis that could not be verified. Per the mission's own instruction —
*fix only if the cause is identified **and** the corrected result is
measurable* — the approach is **rejected and the baseline preserved**.

### 6b. Same-pitch note truncation — hypothesis disproved (previous workstream)

`Sampler.triggerRelease(note, time)` stops **every** active source of a
pitch, so repeated/overlapping notes looked doomed to be cut by the previous
note's release. Measured against a note-alone control across six windows:
ratios 1.363 / 1.069 / 1.015 / 1.003 / 1.000 — no truncation. Releases are
issued **at schedule time**, not audio time, so the collision never occurs
for sequential playback.

### 6c. Adaptive continuous brightness per note

Not pursued. Given §3's bandwidth measurement (nothing above 4 kHz), a
per-note filter would steer a signal with almost no content up there —
and, per 6a, it would also carry the resonant boost. The single shared
filter with instant onset steering remains the reasonable trade for this
material, and its weakness (last-triggered note wins) is now documented
rather than hidden.

---

## 7. Musical timing — verified

The canonical practice clock and the schedule/engine split were **not
modified**, and no competing playback engine was built. Timing correctness
stays with the existing suites: `scorePerformance` (29), `playbackSchedule`,
`playbackSemanticsSprint1`, `staccatoPlayback`, `playbackSeek`,
`scoreFollowAudioSync` — tempo changes, short/sustained notes, chords,
repeated notes, ties, rests, pause/resume, seek/restart, cancellation.

Rendered-audio timing in `audioRender.test.js`: tempo change end to end,
guitar strum transients 9 ms apart, arpeggiated chords 12 ms apart,
fermata ×1.75.

---

## 8. Objective waveform/audio evidence

### `tests/playbackAcceptance.test.js` — 10 frozen cases

| Required case | Covered by |
|---|---|
| simple piano melody | "renders a simple piano melody" — 4 pitches solo-verified + 4 attacks in the melody render |
| piano chords | "renders piano chords without clipping" — both registers present, 0 clipped |
| dynamic changes | "keeps the dynamic ladder ordered and wide" — monotonic + span > 10 dB through the engine curve |
| sustained notes | "sustains a long note and goes silent once stopped" |
| repeated notes | "plays repeated notes as four distinct attacks" — 4 attacks, pitch holds, tail dies |
| solo guitar melody | "renders a solo guitar melody at written pitch" + plucked decay |
| guitar chords | "renders a six-string guitar chord" — no clipping, both registers present |
| mixed-register passage | "keeps registers consistent" — C3 + C5 together |
| sample coverage | "uses the sampled voice and covers every mapped sample" — 0 missing |
| clipping/stuck notes/voice stealing | "never clips a dense full-velocity chord" — 9-note fff, 0 clipped, 0 stolen; tail energy 0 |

### `tests/samplePitchCoverage.test.js` — every mapped file, all 3 sets

78 measurements (30 piano + 31 acoustic + 17 electric), each through the
app's own decode path. The acoustic suite passes outright. The electric
suite — the replacement set — passes outright. The piano suite passes with
only the two documented upstream-sharp keys allowed off.

### Report-only probes

```
node scripts/audio-render/realism-probe.mjs    # dynamics, length, decay, clipping
node scripts/audio-render/sample-audit.mjs    # sample bandwidth + headroom
node scripts/audio-render/sampler-ab.mjs      # M2: sampler/filter isolation
node scripts/audio-render/filter-curve.mjs [cutoff] [Q]  # Tone filter gain curve
node scripts/audio-render/export-examples.mjs  # listening WAVs
```

Note on onset measurement: a sample-to-sample delta count does **not** work
here — the mp3 samples cross any fixed threshold thousands of times per
second. The probe therefore uses a short-time energy envelope; the
acceptance set uses a facet count only as an "≥ N attacks present"
invariant. The strum's fine 9 ms staggering stays with the matched-filter
test in `audioRender.test.js`, which is the right tool for it.

---

## 9. Regressions

Full suite before and after:

| | Before (`920cf44874` clean) | After |
|---|---|---|
| Test files | 9 failed / 315 passed | 9 failed / 318 passed |
| Tests | 8 failed / 3428 passed / 14 skipped | 8 failed / 3464 passed / 14 skipped |

The 9 failing files and 8 failing tests are **identical before and after**
and unrelated to sound: `designPhaseA`, `betaOnboarding`, `uxPolishSprint`,
`ipadLayout`, `mobileLayout`, `minimalAudioUi`, `launchReadiness`,
`scoreFollowMotionModel`, `finalMicLowNoteCorpus` (which fails only in
full-suite ordering and passes in isolation on both). Confirmed by running
the whole suite on the untouched base.

`npx eslint` on everything this workstream touched: **clean**. Three
pre-existing errors remain elsewhere under `src/features/playback/`
(unused import in `pianoAudioBenchmark`, two
`react-hooks/set-state-in-effect` in `useMidiPlayback`/`useScorePlayback`)
— present on base and left alone.

---

## 10. Remaining listening limitations

**No musician has listened to this.** Nothing here establishes that the
output sounds like a real piano or guitar. What is established: pitch
accuracy (with two documented exceptions), no clipping, no stuck/dropped
notes, monotonic and wider dynamics, correct timing, full sample coverage,
and verifiable licence provenance.

Still unresolved and needing human listening:

1. **Timbre is capped by the samples.** Everything above ~4 kHz is silence
   in the bundled sets, so ff can get louder but not genuinely brilliant.
2. **Velocity brightness is one resonant shared filter** (§6a). Its
   resonance follows the note, so soft notes are also the most boosted —
   audibly, this needs checking.
3. **Top-of-compass piano is sharp** — A7 ~+30 cents, C8 ~+91 cents, and
   everything Tone derives from C8.
4. **Piano release is a fade, not a damper model** — no pedal-specific
   release branch, no sympathetic resonance, and no velocity layers
   (single-layer source set).
5. **Guitar is a sampler, not a string** — real pluck decay, but no
   left-hand damping, finger noise or fret/body interaction.
6. **The new electric timbre is unlistened.** It is pitch-verified and
   licence-verified, but nobody has heard whether it reads as a clean
   electric guitar in a mix.
7. **Compression headroom is uneven** — the piano has ~10 dB, the 6-string
   guitar strum only ~3 dB, so guitar ff dynamics already sit near the
   limiter.

---

## 11. Exact next milestone

**Milestone 7 — real velocity layers on the electric voice.**

M2 retired most of the risk: multiple samplers over the same buffers were
measured **bit-identical** (ratio 1.0000), so per-velocity *routing* is
safe as long as it carries **no** per-band filter (§6a shows that is the
part that broke).

1. Download Emilyguitar's `p` and `f` layers for the 17 mapped pitches
   (34 files, ≈19 MB of WAV → ≈3.4 MB of mp3 after the same 192 kbps
   transcode; CC0-1.0, same verified source).
2. Route each note to the `p` or `f` sampler by its post-duck velocity,
   with no filter in front of either. Keep the shared `samplerToneFilter`
   exactly as it is.
3. Acceptance: the frozen dynamic ladder must stay **monotonic** across the
   layer boundary (the failure mode that killed 6a), and the soft/loud
   spectral centroids must separate further than they do now.
4. Leave the piano voice alone — it has no multi-layer source.

**Also queued:** electric velocity layers would let
`velocityLayers` stop being a diagnostic-only constant.

---

## 12. Human listening handoff (M6)

No listening test has been performed, and no claim of acceptance is made.
The artifacts for one are prepared:

`scripts/audio-render/examples/` holds 14 deterministic WAV renders
(regenerate with `node scripts/audio-render/export-examples.mjs`). The
listening subset is:

| File | What it is for |
|---|---|
| `listening-piano-melody` | melody you can follow |
| `listening-piano-chords` | full voicing, two changes |
| `listening-piano-pp-to-ff` | the widened dynamics, five steps |
| `listening-acoustic-guitar-melody` | plucked character and decay |
| `electric-a3` | the new CC0 clean electric tone |
| `guitar-strum-emajor` | strum spacing |
| `piano-dynamics-ladder` | the full pp→fff ladder |

### To A/B "before" and "after"

```bash
cd ~/Documents/scoreflow-sound-engine

# AFTER — current samples and code
node scripts/audio-render/export-examples.mjs
rm -rf /tmp/sound-after && cp -r scripts/audio-render/examples /tmp/sound-after

# BEFORE — the committed baseline (920cf44874)
git stash                    # restores the previous samples + code
node scripts/audio-render/export-examples.mjs
rm -rf /tmp/sound-before && cp -r scripts/audio-render/examples /tmp/sound-before
git stash pop
```

Then listen to `/tmp/sound-before` and `/tmp/sound-after` for the same
filenames. The intended differences are: (a) `electric-a3` is a different,
licence-verified instrument, and (b) the piano ladder and `pp-to-ff` are
wider. Everything else should sound the same — if it does not, that is a
regression.

Questions worth answering while listening:

1. Does the piano still sound like a piano at pp, or has the wider curve
   made soft notes too quiet to use for practice?
2. Does the resonant brightness steering (resonance moving with velocity)
   sound like expressiveness or like a filter effect?
3. Does the CC0 clean electric read as a clean electric in a mix?
4. Is the top-of-compass piano sharpness audible in real repertoire?

---

## 13. What to run

```bash
# sound regression + acceptance (~4 min)
npx vitest run tests/audioRender.test.js tests/playbackAcceptance.test.js \
  tests/samplePitchCoverage.test.js tests/playbackAudio.test.js \
  tests/playbackInstrument.test.js tests/pianoVelocity.test.js \
  tests/pianoRealismSprint1.test.js tests/playbackExpression.test.js \
  tests/guitarPlayback.test.js tests/pianoPlayback.test.js \
  tests/playbackEngine.test.js tests/instrumentCore.test.js

# full suite (expect the 9 pre-existing UI/mic failures, unrelated to sound)
npx vitest run

# measurement tools
node scripts/audio-render/realism-probe.mjs
node scripts/audio-render/sample-audit.mjs
node scripts/audio-render/sampler-ab.mjs
node scripts/audio-render/filter-curve.mjs 1000 1
```
