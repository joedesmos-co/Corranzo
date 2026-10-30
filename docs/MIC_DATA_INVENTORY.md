# Mic research data inventory, ground-truth quality and observability

**Date:** 2026-10-25
**Start:** `2c269be69b`. **End:** data/acceptance infrastructure only — no
production change.

## 1. Corpus inventory (audited from the manifests)

| corpus | clips | what it actually is | truth quality |
|---|---|---|---|
| **mic-real** | **50** (4 excluded) | **natural performances**: GuitarSet 21 (acoustic guitar, mono close-mic), EGSet12 14 + Guitar-TECHS 4 + same-as-audio 1 (electric guitar), Vienna 4x22 10 + 1 (piano) | **Class A** — independent JAMS/MIDI annotations (`sourceTruthFile` per clip), `naturalRecordings: 50`, `provenance: "Detector output never used as truth"` |
| mic-accuracy | 31 (8 with audio) | 23 synthetic (sines/harmonic/speaker simulations); real-piano-c4/e4, real-guitar-g3, room-quiet/noisy, uiowa-piano-mf/pp-c4, uiowa-guitar-mf-g3 | **Class B/C** — six real-timbre single notes (known pitch by construction of the fixture) + synthetic controls |
| mic-polyphony | 21 | `provenance.json`: 9 **isolated-sample composites** (uiowa: real instrument samples mixed into chords), 7 deterministic synthesis, 2 deterministic controls, 2 generated placeholders, 1 generated room bed | **Class B/C** — construction truth only; NOT natural polyphony |
| mic-composites | 6 | real single-note recordings mixed/sequenced (piano C4/C5 Salamander, real piano/guitar) with sample-measured onsets | **Class B** — construction truth (exact onsets), mixture not natural |

**Licences** (all permissive; attribution retained in the manifests):
GuitarSet — CC-BY-4.0 (Zenodo 3371780); EGSet12 — CC-BY-4.0 (Zenodo
11406378); Guitar-TECHS — CC-BY-4.0 (Zenodo 14963133); Vienna 4x22 —
CC-BY-4.0 (DOI 10.21939/4X22); Salamander piano — CC-BY-3.0 (Alexander
Holm); UIowa musical instrument samples — per the repository provenance.

**The central data finding:** the natural-performance corpus is **46 usable
clips** (dev 18 / eval 23 / fresh 9, after 4 exclusions for MIDI/audio take
drift). Every chord finding from earlier missions that used `mic-polyphony`
was measured on **isolated-sample composites or synthesis** — exact labels,
real instrument timbre, but *not* natural polyphony. The two reproducible
wrong-chord families and the semitone case are on `mic-real` (natural), so
they are genuine; the "open-Em strum" and "weak E2" cases are composites.
This distinction was previously implicit; it is now explicit.

## 2. Ground-truth quality classes

* **A — independent acoustic events** (mic-real): a human performance, notes
  annotated from a separate source (JAMS/MIDI). Trustworthy for
  note/chord-level scoring.
* **B — construction truth** (composites): labels exact by construction,
  acoustic content synthetic mixtures. Valid for *pipeline* behaviour, not
  for claims about natural polyphony.
* **C — symbolic/simulated** (generated placeholders, deterministic
  synthesis): pitch content intended, not independently confirmed. Valid
  only as sanity/control fixtures.
* **D — ambiguous** (any recording where the intended note cannot be
  confirmed from the audio): e.g. the mozart excerpts excluded for take
  drift; some uiowa composite level/segment choices. Never used as strong
  algorithmic truth.

## 3. Observability classification of the remaining failures

| failure | evidence available | category |
|---|---|---|
| **Octave ghost** (expect C5, play C4; co-attack) | C5's fundamental *is* C4's 2nd partial; identical onset, decay, and timing; amplitude ratios overlap across instruments (measured repeatedly) | **4 — fundamentally ambiguous on mono** (needs per-string/DI or attack attribution) |
| **Fifth/power-chord sub-band** | The fifth is 1.5× the root (not an integer partial); sub-band energy is body resonance (measured 1.37 sub/own) | **3 — per-string/DI evidence** |
| **Transposed wrong chord** (jazz-dyad, eg08) | Ghost tones are harmonics of the played notes and share their timing; blind estimation is unreliable (P 0.07–0.45, 1.1 ms/frame) | **3 — per-string/DI** (or a much better mono model) |
| **Semitone (55 vs 56)** | Fine-spectrum separation exists but only after 90–190 ms of settled audio; V3 commits at the attack | **2 — distinguishable with better time budget/tuning** (latency trade refused) |
| **Weak low E2** | Fundamental at the noise floor in these recordings; five domains overlap with partial strums | **2/3 — better recording (close-mic/DI) first** |
| **Dense piano** | Masked partials; timing-sensitive completions | **2 — better recording/model**, not a threshold |
| **Deep-bass correct chords** | Anchor sparse but genuine (10–169 frames) | **1 — distinguishable** (persistence rejected only because it also lost they low-E cases; a per-instrument prior could separate) |

No new thresholds were invented for categories 3/4.

## 4. Feasible future sources (assessed, not downloaded)

1. **GuitarSet hexaphonic pickup** (CC-BY-4.0, same Zenodo record as the mono
   files already used): per-string audio for the exact 21 clips → an
   independently labelled polyphony source *and* the per-string evidence the
   octave/fifth/transposition cases need. The repo currently holds only the
   mono `_mic.wav` derivatives; the hex files are a bounded future download
   (a few hundred MB for the used takes).
2. **EGSet12 stems** (CC-BY-4.0): electric-guitar performances; check for
   isolated takes/DI in the record.
3. **Vienna 4x22** (CC-BY-4.0): piano with MIDI; already used; the full
   corpus would enlarge the piano dev/eval sets.
4. **Guitar-TECHS** (CC-BY-4.0): technique-specific takes (palm mute,
   harmonics) for instrument-specific priors.
5. **Isolated-sample mixtures** (UIowa/Salamander): already exploited; label
   as Class B, never as natural generalization.

## 5. Decision (Phase 6)

**Pause algorithm research until per-string/DI or physical data exists.**
Every remaining false family is category 3/4: the evidence that would
separate it is not present in mono mixes. The only category-2 case
(semitone) needs a latency trade the acceptance criteria reject.

The next defensible experiment, *when data exists*: using GuitarSet hex
per-string audio, build a per-string-labelled chord benchmark (isolated
string mixtures with exact labels) and test one falsifiable hypothesis —
"an expected chord tone must be present on a *different string* than the
sounding lower note" — which is the physical fact that mono recording
destroys. That is a data acquisition task first, not a detector tweak.

## 6. Physical acceptance readiness

`docs/MIC_PHYSICAL_ACCEPTANCE.md` remains the checklist. A research-only
browser diagnostic flow is provided in `scripts/mic-acceptance/` (real
microphone, no injection; records input level, sample rate, device,
expected checkpoint, detected evidence, advancement and latency to a local
JSON report; optional local recording only with explicit user consent, never
uploaded). It is not part of the product and must be reviewed before any
integration.
