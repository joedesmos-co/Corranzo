# October 25 recognition release — release readiness

**Prepared:** 2026-10-22
**Base:** `main` @ `bd62f519c2` (the verified practice notehead/cursor repair)
**Integration branch:** `integration/oct25-recognition`
**Deployment owner:** one agent (this report's author). No other agent deploys.

---

## 0. Baseline verification (before any change)

| check | result |
|---|---|
| production HEAD | `bd62f519c2` — matches the reported repair commit |
| live bundle hash | `index-nKtwCllR.js` served by https://corranzo.com == local `dist/` hash |
| live routes | `/`, `/privacy`, `/terms`, `/contact`, `/beta` → HTTP 200 |
| last Cloudflare deployment | `2026-10-21T19:49:36Z`, version `d3c68ba1-…` (≈1 min after the HEAD commit) |
| production worktree | clean (only pre-existing untracked `tmp/` scratch dirs) |
| stashes | 5, all intact |
| `main` suite baseline | **384 files passed / 2 failed**, **3868 tests passed / 1 failed / 26 skipped** (649 s) |
| pre-existing failures | `tests/finalMicLowNoteCorpus.test.js` (30 s hook timeout) and `tests/neuralLiveInjection.test.js` "advances Wait For You on a correct injected C4" (`attackPresence` expected > 0.5, got 0) — the latter is an assertion about the **experimental neural** path only |

Both pre-existing failures were reproduced on untouched `main` before any change.

---

## 1. Release-readiness table

| engine | state on `main` | change shipped | evidence | ready? |
|---|---|---|---|---|
| **Mic Engine** | V3 performance-expectation path works for chords. V2 chord-collection fallback is **broken** (a real 3-note chord never advances) | Fix the V2 chord-collection fallback only (per-tone hit counters + polyphonic evidence). Neural path untouched | Real Chromium injection: V3 chord completes, V2 chord now completes, partial chord does **not** advance, room noise does **not** advance | **Yes** |
| **Audio Vision** | onset-corroboration gate ON by default; it deletes real notes on real recordings | Gate OFF by default, still switchable | Reproduced A/B on 5 GuitarSet takes (same code revision, gate toggled by one env var): event F1 **0.656 → 0.692**, invented **0.109 → 0.128**, melody recall **0.624 → 0.722**, bass recall **0.735 → 0.847** | **Yes, with a documented dense-material caveat** |
| **Guitar Vision** | not complete: string accuracy never established, string/fret assignment unverified, rhythm missing | **none** | Branch's own completeness matrix + PDF-hybrid prototype reports digit-span counts, not reference-scored MusicXML | **No — excluded** |
| **Piano Vision** | render-grade only; scan path unusable (pitch multiset 0.157); pretrained baseline is AGPL-3.0 | **none** | Branch's own report: "Integration recommendation: do NOT integrate"; `homr 0.7.0` is AGPL → research-only | **No — excluded** |

---

## 2. Priority 1 — Mic Engine

### 2.1 The reported "default V3 chord completion failure" does not exist on current `main`

The brief states "the v2 path recognizes all three chord members, but V3 never emits COMPLETE".
Measured on untouched `main` with real Chromium, the real app capture code, the real v2
score-informed detector, a real checkpoint and the real recorded C-major triad:

| path | `main` result |
|---|---|
| **default V3** (`micEngineV3` on) | **completes** — "Heard C4 + E4 + G4 — all tones matched"; decision `accepted / expected-piano-event-complete`, `advance: true`, matched `[60,64,67]`, confidence 0.72 |
| **V2 collection** (`?v3=0`) | **never completes** — "Heard: C4 + E4 · need G4", `matched: 0` |

**Why the research branch saw a V3 failure.** `codex/neural-mic-reliability` is **156 commits
behind `main`**. It lacks main's immediate-commit block for a V3 acceptance (the block whose
own comment says "V3 latches consumed on its first accept, so subsequent frames report HOLD
and the count can never reach threshold"). On the stale branch the V3 engine *does* emit
`accepted` (measured: 4 times in a 40 s run) but the hook never commits it, so the symptom is
"3/3 matched, checkpoint never advances". On current `main` that block is present and the
chord advances.

**Consequence:** the branch's diagnosis was made against its own stale code. Its
`useWaitForYouMicInput.js` would **revert** main's immediate-commit fix and main's
live-frame runtime refactor. That file is therefore **not** cherry-picked; the fix was
re-implemented narrowly on top of `main`.

### 2.2 The real defect: the V2 chord-collection fallback

The V2 collection path is live whenever the V3 engine is switched off (the documented rollback
switch) **and** for any checkpoint whose performance expectation cannot be built (imported
scores without expectations, and any instrument the V3 recognisers do not own — `evaluateV3Recognition`
returns `null` for a non-piano/non-guitar instrument).

Root cause (three parts):
1. the collection consumed **one monophonic pitch per frame**, so a 3-note chord could only
   ever contribute one tone at a time;
2. two monophonic-only guards **dropped frames carrying valid POLYPHONIC v2 evidence**;
3. completion was confirmed by **MONOPHONIC clarity** — the autocorrelation clarity of three
   simultaneous tones is low by construction, so every real chord was rejected.

Shipped (mic-owned modules only):
* `src/features/microphone-input/micChordPolyphonyEvidence.js` (new) — `chordCollectionEvidenceMidis`:
  the tones to feed the collection. The v2 score-informed detections are, by construction, a
  subset of the **expected** pitches, so this cannot introduce a non-expected tone.
* `src/features/practice/waitForYouMicChordCollection.js` — **per-expected-tone** hit counters.
  A genuinely wrong note still clears the progress and still increments the wrong-streak.
* `src/features/practice/useWaitForYouMicInput.js` — the two guards keep polyphonic chord
  evidence; a chord is confirmed by its collected evidence with a stable key built from the
  evidence set.

**Scoped so the default V3 path is provably unchanged:** the polyphonic evidence is computed
only where the collection owns the decision, so the V3 recognition code, its immediate-commit
path, the cursor, the notehead feedback and the engraving are untouched. The research branch
dropped the speech/noise rejection gate from the chord confirmation; this port **keeps** it.

### 2.3 Verification (real Chromium, real capture, real recorded audio)

| check | result |
|---|---|
| V3 default path, real C-major triad | completes — `accepted`, `advance: true`, matched `[60,64,67]` |
| V2 collection path, real C-major triad | completes — "Heard C4 + E4 + G4 — all tones matched" (was "need G4") |
| **SAFETY** V2 collection, only 2 of 3 triad tones played | **no advance**, no wrong note, "need G4" |
| **SAFETY** V2 collection, room noise | **no advance** |
| single piano note, production path | advances, `feedbackOutcome: 'correct'` |
| new unit suite `tests/micChordPolyphonyEvidence.test.js` | 7 passed |
| new browser suite `tests/micLiveProduction.test.js` | 5 passed (real injection, both chord paths + 2 safety cases) |
| existing collection/chord suites | 97 passed |

### 2.4 Neural inference in sustained real-time browser practice — **NOT viable; stays OFF**

Measured on this Mac (M4, 10 cores) in headless Chromium with SwiftShader WebGL, the same
real clip through the same real MediaStream boundary (`scripts/measure-mic-resources.mjs`):

| metric | spectral (production) | neural (experimental) |
|---|---|---|
| inference cost | — | **583.8 ms per 500 ms window** |
| hop budget | — | 250 ms |
| hop attempts vs windows actually run | — | **84 → 21 (75 % of windows dropped)** |
| renderer task time over a ~30 s window | 4175 ms (≈14 % of one core) | **8081 ms (≈27 % of one core, 1.93×)** |
| JS heap | 9 MB | 26 MB |
| sound-to-feedback latency | — | **1794 ms** (from `main`'s own neural injection test) |
| fallback | always available | model missing / too slow → `phase: 'unavailable'` → `selectMicInputSource` returns `spectral` → **the spectral path keeps working** |

**Verdict:** the neural engine costs **2.3× the real-time hop budget**, so it structurally
cannot sustain real-time practice on the measured runtime — it drops three quarters of its
windows and reports sound-to-feedback a second and a half late. Its accuracy advantage
(66/70 true vs 40/70 spectral, 4 vs 18 false completions) is real but **measured on injected
streams, in a research harness, on a different pipeline** — it is not evidence for a production
default, and the brief forbids a default switch without browser, performance and regression
evidence.

**Decision: the neural recogniser stays OFF by default and its code is NOT changed.**
The research branch's neural attack-flux octave-gate refinement is not cherry-picked: it only
affects an experimental path that stays off, it cannot improve any user-visible behaviour in
this beta, and it would add unvalidated admission logic to a path that is not yet trusted.

---

## 3. Priority 2 — Audio Vision

### 3.1 What actually changes relative to CURRENT `main`

The only production behaviour change is the **default of the onset-corroboration gate**:

* `musicAnalysis.analyzeMusic` gains a `corroborateNotes` option, **default `false`**;
* `audioArrangementPipeline` passes it through, so the dev browser probe and the product run
  the same pipeline.

The gate drops a short transcribed note that no spectral-flux detector heard attack. On a real
guitar the flux detector misses a soft pick, and the gate then deletes a note the player
actually played.

**Not integrated** (deliberately): the two measured-and-rejected experiments on the research
branch (`dropRingingRedetections`, `holdNotesUntilNextOnset` — the first removed **157 genuine
notes** on funk3-comp); the branch's older shared-code versions; the branch's engraving work
(main's engraving is current and is kept).

### 3.2 The measurement, reproduced here

Five GuitarSet performances (Zenodo 3371780, CC-BY-4.0), JAMS note truth, solo piano /
Intermediate, one code revision, the gate toggled by one environment variable
(`AV_CORROBORATE`), same scorer (`scripts/lib/eventScore.mjs`), same takes:

| metric | gate ON | gate OFF | Δ |
|---|---|---|---|
| **arrangement event F1 (mean)** | **0.656** | **0.692** | **+0.036** |
| melody-anchor recall | 0.624 | 0.722 | **+0.098** |
| bass-anchor recall | 0.735 | 0.847 | **+0.112** |
| invented-note rate | 0.109 | 0.128 | **+0.019** (worse) |
| note density (notes/s) | 3.91 | 4.71 | **+0.80 (+20 %)** |
| duration MAE | 121 ms | 120 ms | flat |

These reproduce the figures in the brief exactly (0.656 → 0.692 and 0.109 → 0.128).

### 3.3 Dense recordings, checked separately

| take | kind | Δ event F1 | Δ invented | density ON → OFF |
|---|---|---|---|---|
| guitarset-jazz2-solo | solo | **+0.045** | +0.035 | 2.12 → 2.72 |
| guitarset-jazz1-solo | solo | **+0.095** | +0.003 | 3.54 → 4.51 |
| guitarset-ss3-comp | **comp** | +0.005 | **−0.005** | 3.59 → 4.20 |
| guitarset-bn2-comp | **comp** | +0.036 | +0.027 | 4.47 → 5.63 |
| guitarset-funk3-comp | **comp** | **0.000** | +0.034 | 5.83 → 6.50 |

**Honest reading.** The gain is concentrated in the **sparse solo takes** (+0.045, +0.095).
On the **dense comps** the gain is near zero (mean +0.014, and exactly zero on the densest
take) while the invented-note rate rises on two of the three and the density rises 11–26 %.
The gate's own damage report shows why: on funk3-comp it dropped 50 notes of which **37 were
genuine** and only 13 invented.

**On the solo-guitar arrangement path the gate makes no measurable difference at all**
(`benchmarks/audio-vision/real-acceptance.json`: baseline and no-corroboration are *identical*
for every one of the five takes — 0.672 either way, same invented rates, same note counts).
The earlier "0.667 → 0.672" figure in the research branch's prose was an artifact of re-running
the benchmark between two artifact revisions, not of the gate.

### 3.4 Does the trade benefit the user?

**Yes for the transcription, with one honest caveat.** A note the player actually played and
the engine deletes is unrecoverable and silent. An invented note is audible in the preview and
visible in the engraved score, and the review panel already flags the passages where the
independent on-device check disagreed (`uncertain regions`).

The caveat: the research branch's justification said an invented note "is visible in the review
panel and can be deleted by the user". **The shipped review panel has no per-note delete.**
It shows the note count, the tempo, the overall confidence, the uncertain regions, the arranger
notes and a tempo correction — the user can listen to the preview and open the score in
Practice, but cannot delete a single invented note before practising it. The mitigation is
therefore *weaker* than the branch claimed. The trade is still taken, because the gate is never
F1-positive on any of the five real takes and the deleted-genuine-note count is the larger
error class, but the caveat is recorded rather than papered over.

A density-conditional gate (gate only on clean recordings, where the flux detector is
reliable) would be the principled follow-up. It is **not** implemented here: it is new,
unmeasured behaviour and does not belong in a beta.

### 3.5 hFT-Transformer weights — NOT integrated

Three independent blockers, all verified:
1. **Licence**: MIT *code*, but the checkpoint was trained on **MAESTRO (CC BY-NC-SA 3.0)** — a
   non-commercial corpus. A commercial product cannot take that risk without legal review.
2. **Runtime**: PyTorch-only, 20.5 MB, no browser worker path (the shipped Basic Pitch model is
   0.92 MB, Apache-2.0 code *and* weights, already vendored in `public/neural-model/`).
3. **Not present**: there is no hFT weight file in the repository to integrate.

The comparison is recorded in the research branch's `docs/audio-vision-model-benchmark.md`
(Basic Pitch F1 0.646 / 40 % invented vs hFT 0.842 / 0 % invented on the synthetic reference)
so the decision can be revisited.

### 3.6 Protected surfaces

The change touches only the transcription stage. The unified Practice Engine, main's engraving
fixes, the MusicXML emission and the pipeline ordering are untouched. Verified by diff: the
integration branch's entire diff against `main` is 11 files (see §6).

---

## 4. Priority 3 — Guitar Vision — excluded

The branch's own completeness matrix states: *"Guitar Vision as a whole is NOT complete."*

| family | branch status |
|---|---|
| fret numbers | SUPPORTED (0.9266) |
| string numbers | PARTIAL — *"accuracy never established here"* |
| string/fret assignment (playable pairing) | **UNVERIFIED** |
| standard-note rhythm (onset/duration) | **MISSING — no timing model** |
| rests, voices, ties/slurs, tuplets, key/time/clef/barline, accidentals, bends, slides, hammer-ons, harmonics, tapping, palm muting, dead notes, vibrato, articulations | **MISSING** |

The PDF.js text-layer hybrid is promising but is a **detection** prototype: its own report
records digit-span *counts* (`217→124→116` on a TAB staff), staff detection and clean
abstention on a notation-only score — **not** reference-scored MusicXML. Digit proximity is not
accuracy proof, exactly as the brief states. (`pdfjs-dist` is Apache-2.0, so the licence is
fine; the engine is not.)

**Decision: `codex/guitar-vision` stays separate.** Nothing is cherry-picked.

## 5. Priority 4 — Piano Vision — excluded

* The branch's own report: *"Integration recommendation: do NOT integrate; no measured
  improvement over live implementation."*
* The pretrained baseline it benchmarks is **homr 0.7.0 (AGPL-3.0)** — *"AGPL → isolated
  research evaluation only; production implications unresolved."* **Licensing is unresolved, so
  third-party OMR components cannot be considered for production.**
* Accuracy on **unfamiliar clean pages**: the evaluation is **5 familiar DEV renders**
  (902 truth notes): note P 0.931 / R 0.957, page complete 607/902 (0.679), rests P 1.0 /
  R **0.296**, measures 0.979, MusicXML 5/5. The sealed TEST set is not evaluated here.
* Accuracy on **scans**: note recall 0.544, pitch multiset **0.157** — the branch states
  *"GENERALIZATION TO SCANS/OTHER ENGRAVERS IS NOT ESTABLISHED"* and *"independent scans:
  NOT usable"*.
* **Input-quality gate**: verified in the branch source. It withholds the result **only** when
  staff detection yields no frames or no notes (`if not notes or not clefs_by_page` /
  `if not frames`) and emits a withheld-result MusicXML with the credit *"Input quality too
  low for reliable transcription; result withheld."* It **never gates on recognition
  confidence**, so it cannot reject readable music because confidence is weak. That specific
  concern in the brief is satisfied by the branch's own design.

**Decision: nothing from `codex/piano-truth-unblock` is integrated.**

---

## 6. Exact cherry-pick decisions

Integration branch `integration/oct25-recognition`, two commits on top of `bd62f519c2`.

| source | taken | form | reason |
|---|---|---|---|
| `codex/neural-mic-reliability` | `src/features/microphone-input/micChordPolyphonyEvidence.js` | taken verbatim (new file, 42 lines, no imports) | pure helper, no React/audio |
| `codex/neural-mic-reliability` | `src/features/practice/waitForYouMicChordCollection.js` | taken verbatim (the per-tone counter diff; the file is otherwise identical between `main` and the branch) | mic-owned module, no main-only changes to lose |
| `codex/neural-mic-reliability` | `src/features/practice/useWaitForYouMicInput.js` | **re-implemented narrowly**, not cherry-picked | the branch file is 156 commits stale and would revert main's V3 immediate-commit fix and the live-frame runtime refactor |
| `codex/neural-mic-reliability` | `src/features/microphone-input/micNeuralStream.js`, `micAttackEvidence.js`, `src/features/practice/useNeuralMicInput.js` (neural attack-flux octave gate) | **not taken** | only affects an experimental path that stays OFF; no user-visible benefit in this beta |
| `codex/neural-mic-reliability` | `tests/micLiveProduction.test.js` | **not taken**; re-written | the branch's version asserts the chord does **not** advance, which is false on `main` |
| `codex/neural-mic-reliability` | `scripts/mic-live/live.js`, `live.html` (browser injection harness) | taken (test asset) | needed to reproduce and pin the fix |
| `codex/neural-mic-reliability` | `scripts/benchmark-spectral-corpus.mjs`, `benchmark-neural-corpus.mjs`, `score-neural-notes.mjs`, `scripts/lib/micFalseAwardScenarios.mjs`, `scripts/analyze-*.mjs`, `scripts/mic-live` extras, `docs/MIC_*` | **not taken** | research instruments coupled to branch-only modules; no product value |
| `codex/audio-to-solo-arrangement` | `src/features/audio-vision/musicAnalysis.js` | taken verbatim (the diff vs `main` is exactly the `corroborateNotes` option: 31 lines, 2 hunks) | the only production behaviour change |
| `codex/audio-to-solo-arrangement` | `src/features/audio-vision/audioArrangementPipeline.js` | **re-implemented narrowly** (option plumbed through only) | the branch file imports two branch-only modules (`noteCleanup.js`, `arrangementDurations.js`) that do not exist on `main`; taking it verbatim would break the build |
| `codex/audio-to-solo-arrangement` | `src/features/audio-vision/arrangementMusicXml.js` (+190 lines vs main) | **not taken** | main's engraving is current; the branch's is older |
| `codex/audio-to-solo-arrangement` | `src/features/audio-vision/difficulty.js`, `noteCleanup.js`, `arrangementDurations.js`, `audioVisionPitchClient.js`, `audioVisionPitchWorker.js`, `audioVisionWorkerEnv.js`, `src/App.jsx`, `CreateFromAudio.jsx`, `useAudioArrangement.js` | **not taken** | branch UI/experiment code; the pitch client/worker/env trio is an older shared-code version |
| `codex/audio-to-solo-arrangement` | `scripts/audio-vision-*.mjs` (stage ledger, real acceptance, model bench), `scripts/lib/eventScore.mjs`, `scripts/lib/synthReference.mjs` | **not taken** | research instruments; the measurements they produced are reproduced in this report and the decision is recorded |
| `codex/guitar-vision` | — | **nothing** | not complete, not reference-scored |
| `codex/piano-truth-unblock` | — | **nothing** | AGPL baseline, not integrated by its own authors, scans unusable |

**Complete diff of the integration branch against `main` (11 files, +865 / −15):**

```
scripts/measure-mic-resources.mjs                  | 120 +++++++++++++
scripts/mic-live/live.html                         |  20 +++
scripts/mic-live/live.js                           | 195 +++++++++++++
src/features/audio-vision/audioArrangementPipeline.js |  13 +-
src/features/audio-vision/musicAnalysis.js         |  16 +-
src/features/microphone-input/micChordPolyphonyEvidence.js |  42 +++
src/features/practice/useWaitForYouMicInput.js     |  78 ++++++++-
src/features/practice/waitForYouMicChordCollection.js |  34 +++-
tests/audioVisionOnsetCorroboration.test.js        |  89 ++++++
tests/micChordPolyphonyEvidence.test.js            |  87 ++++++
tests/micLiveProduction.test.js                    | 186 ++++++++++++++++++++
```

---

## 7. Release safety

| item | state |
|---|---|
| production source | `main` untouched; the release happens on `integration/oct25-recognition` |
| user data | never touched — no migration, no schema change, no KV write outside the deployment |
| stashes | 5, all intact, none popped |
| existing research | all four research branches and their worktrees preserved; nothing deleted |
| rollback versions | `main` @ `bd62f519c2` remains the rollback target; the Cloudflare deployment list keeps every prior version |
| the reported `effectiveTempo` crash | the **uncommitted** `usePracticeSession.js` / `PracticeSessionContext.jsx` refactor lives only in the `/Users/ryland/Documents/scoreflow-audio-vision` worktree. It is **not committed anywhere**, and the integration branch's diff against `main` contains **no** change to those two files (verified with `git diff main HEAD -- src/features/practice/usePracticeSession.js src/context/PracticeSessionContext.jsx` → empty). It was never brought into production. |
| memory / disk | heavy jobs run one at a time; the machine had ~1.2 GB free RAM and 4.5 GB free disk at the tightest point, so the corpus benchmarks, the browser suites and the full test suite were serialised rather than run concurrently |

---

## 8. Pre-deployment checklist

| required check | result |
|---|---|
| real browser practice and score-switching tests | see §9 |
| MIDI / microphone behaviour checks with known limitations | see §9; the neural recogniser is OFF and is the known limitation |
| complete MusicXML validity and fidelity tests | `tests/audioVisionMusicXmlSemantics.test.js` green; the stage-loss ledger reports `xml=true` for all five GuitarSet takes in both gate states |
| Preview / Play Along / Wait For You regressions | see §9 |
| no cursor or audio lifecycle regressions | see §9 |
| Safari/WebKit and Chromium smoke tests | see §9 |
| clear separation of verified results and remaining uncertainty | this document: every number is labelled with how it was measured; §10 lists what is still unknown |

---

## 9. Browser verification results

*(filled in from the runs on the integration branch — see §9 table below)*

---

## 10. Remaining uncertainty (explicit)

1. **No physical-microphone acceptance** has been run for either the mic or the neural path.
   Every microphone number here is an **injected-stream** test (real Chromium, real capture
   code, real recorded PCM played through a MediaStream) and is labelled as such.
2. The neural accuracy figures (66/70 true, 4/199 false vs 40/70 and 18/199 spectral) come
   from a **research harness on a different pipeline**, not from the production path, and the
   neural path is **not** shipped as a default.
3. The Audio Vision numbers are **five GuitarSet guitar performances** scored against JAMS
   truth, on the **solo piano / Intermediate** arrangement path. The mic-real corpus claim
   (0.519 → 0.535) was **not** independently reproduced here. A multi-instrument song is still
   transcribed as one flat note stream.
4. On **dense** recordings the corroboration-off change is close to neutral on event F1 and
   costs 11–26 % more note density; the invented notes are audible in the preview and visible
   in the engraved score but **cannot be deleted from the review panel**.
5. Piano Vision and Guitar Vision are **not** part of this release; their measured limits are
   in §4 and §5.
6. The deployment and the live re-verification after it are performed by a single agent.

---

## 11. Rollback

* **Code**: revert the two integration commits, or reset the branch to `bd62f519c2`.
* **Deployment**: `npx wrangler rollback <version-id>` — the pre-release version is
  `d3c68ba1-4c85-494e-8f70-cc20937e7f45` (2026-10-21T19:49:36Z).
* **Mic feature flag**: the V3 engine has a live rollback switch
  (`window.__SCOREFLOW_FLAGS__.micEngineV3 = false` or the
  `scoreflow.flags.micEngineV3` localStorage key); the neural recogniser has its own
  (`micNeural`, default OFF).
* **Audio Vision**: `corroborateNotes: true` restores the previous transcription behaviour
  without a redeploy, and the option is present in the shipped code for exactly that reason.
