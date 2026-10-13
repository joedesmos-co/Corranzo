# Sound Engine Research — Playback Realism (Piano & Guitar)

Branch: `codex/notation-aware-audio`
HEAD at start of this workstream: `87c61a40f2` — "real bends/slides/vibrato,
ornaments, deterministic room, fermata sync proof"

This document records what was **measured**, what was **changed**, and what
was **rejected on evidence**. It deliberately stops short of claiming the
result sounds like a real instrument — see §10, Remaining listening
limitations.

---

## 1. Verified branch and commits

```
$ git -C ~/Documents/scoreflow-sound-engine status
On branch codex/notation-aware-audio
Your branch is ahead of 'origin/main' by 3 commits.
nothing to commit, working tree clean

$ git worktree list
/Users/ryland/Documents/scoreflow           fcdb8d0172 [main]
...
/Users/ryland/Documents/scoreflow-sound-engine 87c61a40f2 [codex/notation-aware-audio]
```

- The sound engine lives in the dedicated worktree `scoreflow-sound-engine`,
  on its own branch. `main` was never checked out here and was not modified.
- No new worktree was created and no other agent's worktree was touched.

### Relation to the integrated preview

`87c61a40f2` is an ancestor of `origin/codex/unified-practice-audio-preview`
(tip `8cac636a54`). The preview branch already contains all three
sound-engine commits plus 89 further commits of unrelated product work.

`git diff HEAD origin/codex/unified-practice-audio-preview -- src/features/playback`
returns **empty** — the playback code in this worktree is byte-identical to
the latest integrated practice preview. Nothing was blindly merged, and no
playback work was duplicated.

---

## 2. Sound-engine architecture

```
scorePlaybackSchedule.js   score → performed events (velocity, duration,
                           technique curves, ornaments, strums)
scorePlaybackEngine.js     transport: windowed scheduling, metronome,
                           seek/pause/stop, instrument switching
        ↓
sampledInstrumentVoice.js  shared voice: synth-first fallback, lazy
                           sampler, shared decoded-buffer cache, FX chain,
                           voice-mix ducking, per-note technique notes
        ↓
pianoInstrument.js         Salamander sample set + piano timbre/volumes
guitarInstrument.js        acoustic guitar set + plucked fallback
electricGuitarInstrument.js clean electric set
```

Key design points, all verified in code rather than assumed:

- **Synth fallback sounds immediately.** The oscillator/pluck voice is wired
  before samples decode, so the first note always makes sound and the
  Safari/iPad "unlock on first tap" path keeps working.
- **Decoded buffers are shared per base URL**, so re-created voices
  (seek/loop flush) and multiple tracks never re-fetch. Verified by
  `tests/playbackInstrument.test.js`: a second voice adds 3 samplers and
  zero buffer fetches.
- **Voice-mix ducking** (`pianoVoiceMix.js`) keeps dense chords from
  clipping, and only ducking above 8 simultaneous voices.
- **Technique notes** (bend, release, slide, vibrato, slur) bypass the
  shared sampler for a per-note `ToneBufferSource`, which is the only way
  one note in a chord can move pitch independently.

---

## 3. Sample and license audit

| Asset | Source | License | Redistribution | Attribution |
|---|---|---|---|---|
| Salamander Grand Piano (Yamaha C5) | Alexander Holm — `sfzinstruments/SalamanderGrandPiano` | **CC-BY-3.0** (verified upstream README + LICENSE, `sfzinstruments.github.io`) | Permitted, including modification | Required: author + license |
| Acoustic guitar | University of Iowa MIS (Lawrence Fritts), via `nbrosowsky/tonejs-instruments` | **No restrictions** — "freely available … may be downloaded and used for any projects, without restrictions" (verified on the UIowa site) | Permitted | None required |
| Clean electric guitar | Karoryfer, via `nbrosowsky/tonejs-instruments` | **UNRESOLVED — see below** | — | — |

The tonejs-instruments repository states, in its own README: *Code: MIT
License; Samples: CC-by 3.0*. The bundled mirror holds only 30 + 31 + 17
files (≈7.7 MB total), all edited/transcoded subsets of those originals.

**Unresolved legal question — clean electric guitar.** tonejs-instruments
labels its samples CC-BY-3.0 and credits `guitar el` to **Karoryfer**.
Karoryfer Samples is a **commercial** sample vendor; its website exposes a
paid catalogue and a "Free" section, and no clear license statement for the
specific clean-electric guitar files could be located. The current Terms
page attributes the guitar samples to the tonejs-instruments author as
CC-BY-3.0, which is what the redistributing repo claims — but the
underlying provenance is a commercial vendor whose terms are not verified.

This is recorded as an open question rather than resolved, because:

- no paid library was downloaded and no commercial sample was purchased;
- the electric voice currently works and is covered by tests, so deleting it
  silently would remove working functionality;
- the correct resolution needs the project owner's decision.

**Recommendation for the owner:** either obtain written confirmation from
Karoryfer (samples@karoryfer.com) covering redistribution, or replace the
clean electric voice with the Iowa-derived acoustic set (which is
unrestricted) and drop `guitar-electric/`. Do not ship the electric voice in
a commercial release until this is settled.

A related code hygiene issue was found: `src/features/legal/legalInfo.js`
exports `SOUND_CREDITS`, but no component or test consumes it — the Terms
page (`TermsOfServicePage.jsx`) hardcodes the same credits in JSX. Two
sources of truth that can drift. **Not fixed in this workstream** (it is a
UI change outside the sound-engine scope) but recorded here.

### What the samples can actually deliver

Measured by `scripts/audio-render/sample-audit.mjs` (FFT of the sustain
window of every bundled set):

| Set | Energy below 4 kHz | Energy above 8 kHz | Above 12 kHz |
|---|---|---|---|
| salamander (A0…C8) | 0.99–1.00 | 0.001–0.003 | ~0 |
| guitar-acoustic | 0.951–0.994 | 0.001–0.010 | 0–0.003 |
| guitar-electric | 0.795–0.986 | 0.003–0.144 | 0–0.055 |

**Every bundled set is effectively band-limited to ~4 kHz.** The original
Salamander library has 16 velocity layers (394 MB); the shipped subset is a
single 2 MB minor-thirds lite set, and the mp3 transcode has no energy
above 12 kHz.

Consequence for the mission's realism goal: **brightness work past ~4 kHz
has nothing to act on.** This is why the "fix velocity brightness" idea in
§6 was rejected — the samples cannot carry a brilliant ff timbre, so
opening a filter wider only adds hiss, not brilliance. A materially better
ff/pp timbre contrast would require the velocity-layered set, which is a
big download and explicitly out of scope.

---

## 4. Piano playback — what changed

### Dynamic range widened (measured, kept)

`mapPlaybackVelocity` (`pianoVelocity.js`) softened velocity with exponent
1.22 and a 0.08 floor, compressing pp and ff toward the middle of the
scale. Headroom was measured as unused: an 8-note fff chord peaks at 0.212
against a −3.5 dB limiter ceiling of 0.671, i.e. **10 dB of unused
headroom**, while the audible pp→ff span was only ~7.5 dB.

Measured through the real engine path (curve applied exactly where
`scorePlaybackEngine.softenVelocity` / `referenceNotePlayer` apply it):

| Curve | pp gain | ff gain | pp→ff span | Monotonic | Peak at ff |
|---|---|---|---|---|---|
| before (exp 1.22) | 0.203 | 0.920 | **12.0 dB** | yes | 0.0853 |
| after (exp 1.7) | 0.167 | 0.918 | **16.3 dB** | yes | 0.0851 |

A real piano spans roughly 20 dB over the same written range, so this is a
real improvement without making pp inaudible (pp peak 0.0126) and without
raising the loudest peak by any measurable amount.

All existing ordering assertions still hold (`pianoVelocity.test.js`,
`playbackAudio.test.js`), and the widening is pinned by a new frozen
threshold in `tests/playbackAcceptance.test.js`
(`pp→ff span > 10 dB`, strictly monotonic).

### Everything else — measured, left alone

- **Sustained notes / release:** piano audible length 1.91 s with the
  1.85 s release tail; the tail decays to silence by the end of the render
  (tail energy 0). No stuck notes.
- **Repeated notes:** 4 repeated A4s render as exactly 4 detected attacks,
  0 duplicates skipped, no overlap truncation.
- **Chords / polyphony:** 9-note fff chord peaks at 0.3347 (limiter 0.671)
  with **0 clipped samples and 0 voices stolen**.
- **Pitch:** all melody notes within 35 cents of written pitch
  (`pianoVelocity`-independent; measured by the acceptance set).

---

## 5. Guitar playback — findings, no change needed

Measured via the same harness:

- Acoustic plucked decay ratio early/late = **7.14×** (a note is clearly
  decaying well inside its own written span — the plucked character is
  there).
- 6-string strum peaks at 0.4653, **0 clipped samples**.
- Guitar audible length 1.58 s.
- 31 acoustic samples load, **0 missing**.

No guitar defect was found that a small safe change would fix, so nothing
was changed. Two honest limits, already documented in
`electricGuitarInstrument.js`:

- the electric set is missing E3/E4/E5/G/B notes, which pitch-shift from
  neighbours (≤2 semitones below E5; disclosed high-register degradation);
- only a **clean** tone is provided. Crunch/distortion are unsupported.

**No claim of acoustic or electric guitar simulation fidelity is made** —
no listening test was performed.

---

## 6. Rejected on evidence (recorded so it is not retried blindly)

These were implemented or prototyped and then removed because measurement
disagreed with the hypothesis.

### 6a. Per-velocity brightness bands — implemented, measured, reverted

**Hypothesis.** The voice routes the whole polyphonic sampler through ONE
lowpass and re-aims it at each note's onset, so the note triggered last
determines the brightness of everything still ringing. A loud note drags a
soft accompaniment bright and vice versa — the velocity response should not
survive overlap. Fix: three filter bands (soft/medium/loud) over the *same*
decoded buffers, chosen per note.

**Implementation.** Built and wired (band 0 reusing the primary sampler so
no extra memory or fetch; `tests/playbackInstrument.test.js` and
`pianoAudioBenchmark.js` updated accordingly). It worked: soft notes did get
dark (spectral centroid 688 Hz vs 814 Hz before) and stayed dark.

**Why it was reverted.** The per-velocity render table was non-monotonic
across a band boundary:

| velocity | 0.44 | 0.45 | 0.46 | 0.50 |
|---|---|---|---|---|
| energy | 3.552 | 3.716 | **3.314** | 3.915 |

Raising velocity from 0.45 to 0.46 made the note **11 % quieter**, and the
crescendo acceptance case (`attacks[i] > attacks[i-1] * 1.03`) failed at
the same boundary. The step could not be explained to the point of being
safe to ship, and it broke a validated dynamic-ramp guarantee. The
amplitude behaviour of band 0 was also inconsistent with a plain lowpass
(+13 % energy despite a narrower filter). Reverted in full; the working
tree on this point is identical to `87c61a40f2`.

A correct version needs the amplitude anomaly explained first. The most
likely root cause is that the band samplers built via
`buildSamplerFromBuffers` are not gain-identical to the primary sampler —
worth checking with an isolated two-sampler A/B before retrying.

### 6b. Same-pitch note truncation — hypothesis disproved

`Sampler.triggerRelease(note, time)` in Tone v15 stops **every** active
source of that pitch, so a repeated or overlapping same-pitch note looked
doomed to be cut short by the previous note's release.

Measured with a short first note overlapping a long second note on the same
pitch, against a note-alone control, across six time windows:

```
window      solo        overlap     ratio
0.35-0.5s   0.019361    0.026386    1.363
0.6-0.9s    0.009321    0.009964    1.069
0.9-1.2s    0.004873    0.004946    1.015
1.2-1.6s    0.002315    0.002322    1.003
1.6-2.2s    0.001155    0.001156    1.000
```

No truncation. Releases are issued **at schedule time**, not at audio time,
so by the time note N's release runs, note N+1 has not been started yet —
the per-pitch collision does not occur for normal sequential playback. Only
an explicit later `triggerRelease` on a pitch with a still-ringing note in
another voice (voice stealing above 72 voices) can hit a neighbour, which
is intended.

The probe files were removed after the hypothesis was disproved.

### 6c. Adaptive / continuous brightness per note

Also not pursued. Given §3's bandwidth measurement (nothing above 4 kHz),
a per-note filter would be steering a signal that has almost no content up
there, and a shared per-note approach would need per-note audio nodes on
the hot path of a 16 GB M4 with real-time playback. The current single
shared filter with instant onset steering is a reasonable cost/benefit for
the material at hand, and its weakness (last-triggered note wins) is now
documented instead of hidden.

---

## 7. Musical timing — verified

The canonical practice clock and the schedule/engine split were **not
modified**. No competing playback engine was built. Timing correctness is
covered by the existing suites, which remain green:

- `scorePerformance.test.js` (29), `playbackSchedule.test.js`,
  `playbackSemanticsSprint1.test.js`, `staccatoPlayback.test.js`,
  `playbackSeek.test.js`, `scoreFollowAudioSync.test.js`
  — tempo changes, short/sustained notes, chords, repeated notes, ties,
  rests, pause/resume, seek/restart, cancellation.
- Rendered-audio timing: `audioRender.test.js` — "performs a tempo change
  end to end: schedule times and rendered onsets halve the gap",
  "staggers guitar strums low→high: each string transient lands 9 ms apart",
  "staggers arpeggiated chords 12 ms apart", fermata duration ×1.75.

---

## 8. Objective waveform/audio evidence

Frozen acceptance set: **`tests/playbackAcceptance.test.js`** (10 cases,
all passing, ~42 s).

Coverage map for the mission's required cases:

| Required case | Covered by |
|---|---|
| simple piano melody | "renders a simple piano melody" — 4 pitches solo-verified at written pitch + 4 detected attacks in the melody render |
| piano chords | "renders piano chords without clipping" — both registers present, 0 clipped |
| dynamic changes | "keeps the dynamic ladder ordered and wide" — monotonic + span > 10 dB through the engine curve |
| sustained notes | "sustains a long note and goes silent once stopped" — sustain/release/silence |
| repeated notes | "plays repeated notes as four distinct attacks" — 4 attacks, pitch holds, tail dies |
| solo guitar melody | "renders a solo guitar melody at written pitch" — 4 pitches + plucked decay |
| guitar chords | "renders a six-string guitar chord" — no clipping, both registers present |
| mixed-register passage | "keeps registers consistent" — C3 + C5 together |
| missing notes / coverage | "uses the sampled voice and covers every mapped sample" — 0 missing for both instruments |
| clipping / distortion | "never clips a dense full-velocity chord" — 9-note fff, 0 clipped samples |
| stuck notes | tail energy = 0 after the last note's release |
| voice stealing | `diagnostics.voicesStolen === 0` asserted in six cases |

Reproducible measurement tools (report-only, no assertions, so they can be
used to judge a future change rather than guess):

```
node scripts/audio-render/realism-probe.mjs   # dynamics, length, decay, clipping
node scripts/audio-render/sample-audit.mjs    # sample bandwidth + headroom
node scripts/audio-render/export-examples.mjs # listening WAVs (pre-existing)
```

Note on onset measurement: a sample-to-sample delta count is **not** usable
on these sets — the mp3 noise crosses any fixed threshold thousands of
times per second. The probe therefore uses a short-time energy envelope
with clustering. The acceptance set uses a facet count only as a
"≥ N attacks present" invariant, and the strum's fine 9 ms staggering stays
with the matched-filter test in `audioRender.test.js`, which is the
appropriate tool for it.

---

## 9. Regressions

Full suite, before and after, on this branch:

| | Before (`87c61a40f2` clean) | After |
|---|---|---|
| Test files | 9 failed / 315 passed | 9 failed / 316 passed |
| Tests | 8 failed / 3428 passed / 14 skipped | 8 failed / **3438** passed / 14 skipped |

The 9 failing files are **identical before and after** and are unrelated to
sound: `designPhaseA`, `betaOnboarding`, `uxPolishSprint`, `ipadLayout`,
`mobileLayout`, `minimalAudioUi`, `launchReadiness`,
`scoreFollowMotionModel`, and `finalMicLowNoteCorpus` (which fails only in
full-suite ordering and passes in isolation on both). The sound-engine
commits on this branch already note "Pre-existing UI-token failures
untouched (fail on base too)".

The +10 passing tests are the new acceptance set.

Sound regression suites specifically (219 tests, all green):
`audioRender`, `playbackAcceptance`, `playbackAudio`, `playbackInstrument`,
`pianoVelocity`, `pianoRealismSprint1`, `playbackExpression`,
`guitarPlayback`, `pianoPlayback`, `playbackEngine`, `instrumentCore`,
`audioReadiness`, `playbackSemanticsSprint1`, `playbackSchedule`,
`staccatoPlayback`, `densePianoPlayback`.

`npx eslint` on everything this workstream touched: **clean**. Three
pre-existing errors remain elsewhere under `src/features/playback/`
(`pianoAudioBenchmark` unused import, and two `react-hooks/set-state-in-effect`
in `useMidiPlayback`/`useScorePlayback`) — confirmed present on base and
left alone.

---

## 10. Remaining listening limitations

**No musician has listened to this.** Nothing in this workstream establishes
that the output sounds like a real piano or guitar. What is established:
pitch accuracy, no clipping, no stuck notes, no dropped notes, monotonic
and wider dynamics, correct timing, and honest coverage of every attempt.

Specifically still unresolved and needing human listening:

1. **Timbre is capped by the samples.** Everything above ~4 kHz is silence
   in the bundled sets. ff can get louder but not genuinely brilliant.
2. **Velocity brightness is one shared filter.** A soft note under a loud
   accompaniment is still dragged brighter than it should be (§6a explains
   why the fix was pulled).
3. **Piano release is a fade, not a damper model.** `release: 1.85` is a
   good global value; there is no pedal-specific release branch and no
   sympathetic resonance.
4. **Guitar is a sampler, not a string.** No real left-hand damping, no
   finger noise, no fret/body interaction. Pluck decay is real, but
   repeated-note realism is a resampler's.
5. **Electric guitar register degradation** above E5 is documented but
   unlistened.
6. **The electric guitar license is unresolved** (§3) — a shipping
   blocker independent of sound quality.
7. **Compression headroom is deliberately uneven.** The piano has ~10 dB of
   headroom, the 6-string guitar strum only ~3 dB, so guitar ff dynamics
   are already near the limiter.

---

## 11. Exact next milestone

**Milestone 6 — explain and land the brightness-band amplitude anomaly, or
close it out.**

1. Isolated A/B of two `tone.Sampler`s built from the *same* decoded buffers
   by `buildSamplerFromBuffers` — render a fixed note through each and
   compare gain. This decides whether §6a's +13 % soft-band anomaly is a
   sampler-construction difference (fixable: pass volume consistently) or
   something in the filter chain.
2. If it is a sampler-gain difference, land the three-band brightness
   routing with the amplitude anomaly measured away, and re-run the
   frozen acceptance set including the crescendo boundary case.
3. If it is not, write up why the shared filter stays and file the band
   approach as rejected-with-reason.

Success criterion: per-note timbre survives overlap **and** per-velocity
loudness stays monotonic (no boundary inversion anywhere in the dynamic
ladder), verified by the frozen acceptance set plus
`realism-probe.mjs`.

**Also queued (outside sound):** give `SOUND_CREDITS` in `legalInfo.js` a
real consumer so the Terms page and the credit record cannot drift, and get
a decision on the Karoryfer-derived clean electric samples.

---

## 12. What to run

```bash
# sound regression + acceptance (219 tests, ~2 min)
npx vitest run tests/audioRender.test.js tests/playbackAcceptance.test.js \
  tests/playbackAudio.test.js tests/playbackInstrument.test.js \
  tests/pianoVelocity.test.js tests/pianoRealismSprint1.test.js \
  tests/playbackExpression.test.js tests/guitarPlayback.test.js \
  tests/pianoPlayback.test.js tests/playbackEngine.test.js

# full suite (expect 9 pre-existing UI/mic failures, unrelated to sound)
npx vitest run

# measurement tools
node scripts/audio-render/realism-probe.mjs
node scripts/audio-render/sample-audit.mjs
```
