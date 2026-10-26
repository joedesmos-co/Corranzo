# Hexaphonic per-string evidence — availability and feasibility decision

**Date:** 2026-10-25
**Start:** `4a3c0f9d6d` (+ current `main`). **End:** feasibility study only — no
production change, no acquisition executed.

## 1. Phase 1 — per-string source verification

**What GuitarSet provides** (Zenodo record 3371780, **CC-BY-4.0**, verified via
the Zenodo API): the dataset was recorded with a **hexaphonic pickup** and
explicitly provides *"recordings of the individual strings"*, with
time-aligned annotations of pitch contours, **string and fret positions**,
chords, beats, downbeats and playing style. The record description confirms
the hexaphonic design; the corpus is the same one already used for the 21
acoustic mic-real clips.

**File availability (exact sizes from the API):**

| archive | size |
|---|---|
| `annotation.zip` | 37 MB |
| `audio_mono-mic.zip` | 626 MB |
| `audio_mono-pickup_mix.zip` | 651 MB |
| `audio_hex-pickup_original.zip` | **3062 MB** |
| `audio_hex-pickup_debleeded.zip` | **3440 MB** |

The 21 mic-real clips come from **12 distinct takes** (e.g.
`gs_04_Jazz2-110-Bb_solo_mic.wav` → hex counterpart
`04_Jazz2-110-Bb_solo_hex.wav`). Per-take files are **not** offered
individually: a bounded 12-take acquisition requires downloading the full
3.4 GB archive.

**Disk math:** 8.3 GiB free; after the 3.4 GB download ≈4.9 GiB — below the
mission's 5 GiB stop line, and extraction needs more. The 3.0 GB original
also leaves <5.5 GiB before extraction. **A bounded acquisition is not
permitted under the current resource rules.** The precise next action is
recorded in §7 so it can be executed when ≥2 GB more free space exists.

**Synchronization and leakage:** the hex channels and the mono mic were
recorded simultaneously (the annotations were derived from the hex), so they
are time-aligned by construction. The existence of a **"debleeded"** variant
proves the raw hex channels have **channel crosstalk**; even with debleeding,
per-string isolation is not perfect. Any future per-string experiment must
report the crosstalk uncertainty rather than assume perfect isolation.

## 2. Phase 2/3 — what per-string evidence would resolve (observational)

Using the evidence already measured in this research (no new download):

| mechanism | mono evidence (measured) | per-string view |
|---|---|---|
| Octave ghost (expect C5, play C4, co-attack) | C5's fundamental is C4's 2nd partial; identical onset/decay; amplitude overlap across instruments | The C5 band appears in the **same channel** as C4 on the hex recording; a separately played C5 appears on a different string/channel → separable |
| Fifth / power-chord sub-band | body resonance lights E-12 (sub/own 1.37 on a real fifth) | The fifth's fundamental lives in its **own channel**, not as a sub-band of the root's channel → separable |
| Transposed wrong chord (jazz-dyad, eg08) | ghost tones are harmonics of the played notes, sharing their timing; blind mono estimation P 0.07–0.45 | Each expected tone's channel excitation can be checked against the string/fret annotation → separable |
| Weak low E2 | fundamental at the noise floor of the mono mix; five domains overlap with partial strums | The low-E string's **own channel** is not masked by the upper strings → likely observable |
| Semitone 55-vs-56 | requires 90–190 ms of settled audio (latency trade) | The two performances differ in string/fret and in channel pitch; separable with labels |

The information that resolves the remaining families is **which string was
excited** — precisely what a mono mix destroys.

## 3. Phase 4 — can mono plus guitar priors approximate it?

Analyzed, not assumed:
* **Tuning/fret constraints** restrict which pitches are playable, but the
  ambiguous cases (C4 vs C5, G3 vs G4) are *both* playable on a standard
  guitar, so the prior does not disambiguate them.
* **The score's `expectedStringFrets`** names the intended string, but the
  detector cannot tell which string actually sounded from a mono mic — the
  attribution is the missing observation, not the constraint.
* **Attack order** can help rolled strums identify the bass-first order, but
  the false families are **co-attack** chords (simultaneous), where order
  carries no information.
* **Register/string harmonic envelopes** overlap between strings (measured
  earlier: same pitch classes on different strings have similar profiles).

Conclusion: a guitar prior cannot recover string attribution from a mono
mix; it can only constrain candidates. **No mono improvement is justified by
the per-string evidence.**

## 4. What was executed

No acquisition (resource rule), no detector changes. The observational
analysis reuses the measured mono evidence from the earlier missions
(`docs/MIC_HARMONIC_ATTRIBUTION.md`, `MIC_CHORD_COOCCURRENCE.md`,
`MIC_BLIND_PITCH_STOP.md`, `MIC_DATA_INVENTORY.md`). The acceptance harness
(`scripts/benchmark-repeats.mjs`, `scripts/mic-acceptance/`) is preserved for
future physical testing.

## 5. Ground-truth reliability (relevant to the future experiment)

GuitarSet annotations carry documented known errors (two incorrect timings,
one duplicated MIDI note) and are derived from the hex pickup with
string/fret labels. For a per-string benchmark: use the JAMS string/fret
labels as truth, exclude the known-error takes, and treat debleeded channels
as *evidence with crosstalk*, not as perfect isolation.

## 6. Decision

**Pause Mic Engine algorithm research for the mono microphone.** The
remaining false families require string attribution that mono recordings do
not contain; every mono-side heuristic tested across nine research rounds
failed the negative controls. Per-string evidence would resolve them, but it
is only available in a 3.4 GB archive that the current disk budget cannot
accommodate.

## 7. Narrow next experiment (when resources allow)

**Acquire and test the per-string hypothesis (bounded, one experiment):**
1. When ≥6 GiB free: download `audio_hex-pickup_debleeded.zip` (3.4 GB),
   extract only the 12 takes used by mic-real (≈0.2 GB), delete the zip.
2. Build a per-string benchmark: for each take, per-string excitation
   (Goertzel at the annotated pitch in each channel, with a crosstalk
   floor), mono mix, JAMS truth.
3. Falsifiable hypothesis: *a chord tone is independently excited iff its
   pitch is present in the channel of a different string than the sounding
   lower note, above the debleeded crosstalk floor.* Acceptance: separates
   the four false families (octave ghost, transposed dyad, transposed triad,
   semitone) from their true controls with ≥90 % precision and no legitimate
   chord rejected, at ≤1 ms/frame.
4. This would justify a **per-string/DI recognition mode**, not a mono
   improvement. Mono production stays as-is.

## 8. Stop/continue

**Pause algorithm research until the per-string data or physical-microphone
acceptance is available.** The next value comes from data, not thresholds.
