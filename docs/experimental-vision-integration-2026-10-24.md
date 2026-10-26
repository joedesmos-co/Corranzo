# Experimental Piano/Guitar Vision integration (2026-10-24)

**Status:** opt-in experimental recognition, gated off by default.
No research branch was merged. The standard PDF/image OMR path remains the
default for every existing user.

## 1. Production-compatible files

**Piano vector**

* `src/features/vision/pianoVectorCore.js` — PDF.js-only vector extraction,
  key/time/accidental parsing, MusicXML, quality assessment.
* `src/features/vision/vectorVisionClient.js` — bytes/cancellation/progress
  adapter and honest failure results.

**Guitar TAB vector**

* `src/features/vision/guitarTabCore.js` — browser/Node PDF.js digital-TAB
  extraction and TAB MusicXML.
* `vectorVisionClient.js` — converts recovered string/fret events into the
  existing two-staff Corranzo guitar engraver (standard notation + six-line
  TAB), keeping the recovered string/fret.

**Product wiring**

* `src/features/vision/experimentalVisionFlag.js` — explicit opt-in key/URL.
* `src/components/library/PdfOmrPlaybackPanel.jsx` — tries the experimental
  client first, reports failure, then falls back to standard preparation.
* `src/components/library/ImportScoreView.jsx` — experimental draft banner and
  practice-mode gate.
* `src/components/practice/PracticeView.jsx` / `WorkspaceTransport.jsx` — the
  gate persists into the workspace; only Preview is available for an
  incomplete-timing draft.
* `src/App.jsx` — stores `omrMeta.experimentalVision` with the score.

## 2. Piano Vision — measured results

All results are from the committed vector fixtures, scored by this
implementation against their independent reference MusicXML. The matcher used
here is deliberately strict: exact MIDI + measure + written duration.

| fixture | reference notes | exact events | precision | recall | issue |
|---|---:|---:|---:|---:|---|
| beginner-single | 32 | **32** | 1.000 | 1.000 | rest duration mismatch -> measure 6 invalid |
| rhythm-tuplets | 63 | 43 | 0.683 | 0.683 | ties/slurs detected but not transcribed; measure invalid |
| grand-voices | 88 | 76 | 0.864 | 0.864 | ties/slurs not transcribed |
| dense-advanced | 264 | 154 | 0.681 | 0.583 | unresolved noteheads; measure invalid |
| **total** | **447** | **306** | — | **0.685** | — |

The research commit reports 321/447 complete events (71.8%). The difference is
the matcher: this audit requires exact written duration; the research
"complete" matcher is more permissive. The lower number is the conservative
one. The canonical evaluator is `scripts/vision-piano-reference-eval.mjs`
(raw MusicXML duration/divisions + dots + 1-based `measure@number`); it reports
306/447 and 3/6 rests on current main, resolving the earlier 305/447 ad-hoc
discrepancy.

The beginner fixture's 32 pitches and durations are exact, but its detected
rest is an eighth instead of the reference quarter, so measure 6 does not fill
4/4. The practice gate correctly blocks it rather than treating it as a
practice-ready score. This is exactly the "do not fabricate timing" rule.

### Real-world / unfamiliar PDFs

The vector core returns `route: image / no staff systems` for:

* `corranzo-holdout-intake/Ao no Sumika (Piano).pdf`
* `public/fixtures/demo-minuet-in-g.pdf`
* `public/fixtures/practice-library/piano-brahms-lullaby/piano-brahms-lullaby.pdf`

They fall back to standard image preparation. No vector accuracy is claimed
for them. Multi-page PDFs are rejected explicitly by the experimental client
and fall back; the core currently reads one page.

### Blockers to default

* Only ReportLab/SMuFL vector fixtures are supported; real-world piano PDFs
  tested here are raster/different-font and fall back.
* Ties/slurs are detected as unsupported evidence but not transcribed.
* Independent voices are staff-only; polyphonic same-staff ownership is not
  solved.
* Rest glyph/reference mismatch; dense-layout measure validity.
* Key/accidental logic is implemented and `<alter>` is now serialized, but the
  controlled corpus is C-major and does not exercise it against an independent
  accidental reference.

## 3. Guitar Vision — measured results

Digital paired fixture, independent reference MusicXML:

* 116/116 string+fret+measure events, 8/8 measures;
* 232 pitches in the generated two-staff MusicXML (standard notation + TAB);
* every note carries `<technical><string>/<fret>`;
* OSMD engraves 32 TAB notes (six-line staff) and does not use the PDF canvas.

Duration channel: **evidence-based for the controlled paired fixture.**
The browser port now recovers notehead + stem/beam/flag evidence:
- paired/chords: 32/32 onsets confident, 32/32 quarter durations, 8/8 measures;
- techniques: 32/32 onsets, 8/8 measures, but the reference tie markup is still
  unsupported;
- notation-only mixed fixture: 40/40 onsets, 16 eighth + 24 quarter, exact
  (this is notation-only, not a TAB event stream);
- sparse TAB: 32 string/fret events but 0 durations; pitch-only, no invented
  quarters.

Practice remains disabled for all guitar vector scores because ties, rests,
dots and independent voices are not audited. The experimental MusicXML is a
preview/engraving draft, not a fabricated practice target.

### Two-staff duplication audit

For the paired fixture:

* 116 distinct musical events, 32 chord onsets;
* 232 `<pitch>` and 232 `<technical>` entries because the same event is emitted
  on staff 1 (standard notation) and staff 2 (TAB) after a `<backup>`;
* `parseMusicXml` / `buildNoteCheckpoints` yields **32 practice checkpoints**,
  not 64;
* playback validation yields **116 playable events** and **8 measures**, not
  232;
* OSMD renders 32 TAB notes/chord onsets; no note is duplicated in playback or
  practice targets.

Real-world digital-TAB PDFs (unfamiliar, text-layer, multi-page) recover:

| PDF | events | measures | rhythm |
|---|---:|---:|---|
| canon-in-d | 739 | 22 | unrecovered / multi-voice |
| save-me-bts | 290 | 44 | unrecovered / multi-voice |
| gravity-falls | 99 | 23 | unrecovered / multi-voice |
| home-undertale | 139 | 21 | unrecovered / multi-voice |

All are marked pitch-only and practice-disabled. Scanned/image-only TAB is not
supported by the browser path and falls back to the standard image OMR path.

### Blockers to default

* Ties, rests, dots and independent-voice ownership are not audited; practice
  remains disabled even where onset durations are evidence-based.
* Rest/ties are not emitted; multi-voice layouts unresolved.
* Real-world TAB is multi-page; the current experimental client reads one page
  and rejects multi-page PDFs rather than silently truncating.
* Only the controlled digital TAB fixture has complete string/fret reference
  parity; real-world layouts need independent references.
* No Python runtime, PyMuPDF or undocumented weights were added; PDF.js is the
  only new runtime path (already Apache-2.0 via `react-pdf`).

## 3b. Piano rest repair — reviewed, rejected for practice promotion

`3db0b7df18` adds a math-only measure-fill rest reconciliation. It makes the
beginner fixture 1/1 rest and 8/8 measures and would set practice-ready true.
It is **not integrated** because the same rule promotes legitimate eighth rests
with an undetected note, pickup/incomplete measures, a wrong decoded meter and
a short voice on a multi-voice staff. The negative controls and the exact
promotion table are in `docs/piano-vector-rest-audit-2026-10-24.md`; the
candidate stays research-only and the production practice gate remains false
for the beginner fixture.

## 4. Flag, fallback and practice gate

Enable explicitly:

```js
localStorage.setItem('corranzo-experimental-vision-engine-v1', 'piano-vector')
localStorage.setItem('corranzo-experimental-vision-engine-v1', 'guitar-vector')
```

or `/?experimentalVision=piano-vector` / `?experimentalVision=guitar-vector`.

Default: off. Any vector failure reports the reason and falls back to standard
preparation. Standard OMR results carry no experimental metadata and keep all
three practice modes as before.

For experimental scores, `omrMeta.experimentalVision.practiceReady` controls the
gate. When false, Play Along and Wait For You are disabled in the import view
and in the workspace transport; Preview/engraving remains available. The gate
persists through save/reload because the metadata is stored with the score.

## 5. Real-browser acceptance

| flow | Chromium | WebKit |
|---|---|---|
| Piano vector upload -> draft -> engraving -> save/reopen -> gated modes | PASS | PASS |
| Guitar TAB upload -> 232-pitch standard+TAB XML -> engraving -> save/reopen -> gated modes | PASS | PASS |
| Scanned guitar fallback -> standard path, no experimental metadata | PASS | PASS |
| Flag off -> standard path, no experimental gate | PASS | PASS |
| **total** | **24 / 24** | **24 / 24** |

No application console or page errors. The same 24/24 flows also pass against the built `dist` bundle in Chromium and WebKit.

## 5b. Round-2 verification (2026-10-25)

* Full unit suite: **3956 passed, 19 skipped, 0 failed**.
* PDF-first standard flow: **4 / 4** (PDF workspace, page follow, three modes).
* Audio Vision critical UX: **19 / 19** (progress, 93 BPM tempo rebuild,
  restart/reopen, cancellation 35 ms, unsupported/malformed/silence).
* Unified WebKit: **12 / 12** (Practice Engine, cursor, TAB, engraving).
* Unified mic practice: **23 passed, 0 failed, 1 skipped**.
* Experimental Vision flow: **24 / 24 Chromium** and **24 / 24 WebKit** on the
  dev server and on the built `dist` bundle.
* Guitar rhythm: 116/116 string+fret+measure; 32/32 confident onsets and 8/8
  measures on the paired fixture; 40/40 notation-only mixed onsets
  (16 eighth + 24 quarter); sparse TAB abstains with null durations.
* Two-staff audit: 116 distinct events, 32 checkpoints, 116 playback events,
  232 pitches/technicals (2 representations), no duplicated playback targets.
* Piano rest candidate: reproduced but rejected; canonical strict scorer is
  **306/447 notes, 3/6 rests** on current main (305 was the earlier ad-hoc
  evaluator; `measure@number` is 1-based). Negative controls show the
  measure-fill rule false-promotes four ambiguous cases.

## 6. Deployment

| item | value |
|---|---|
| source commits | `ab4d94cf53` (vision), `5d5ae10c36` (mic) |
| bundle | `dist/assets/index-B2-EFkfL.js` |
| bundle SHA-256 | `66db0b80a3b6aae39d10bbe0170b40aade98360d39761d4477baf7a8c38f9c2a` |
| Worker version | `46ba60fa-fabc-44bc-b93b-31ccde4e234f` |
| deployment id | `fb92d768-1d65-423d-8248-4f8859608054` |
| live bundle | `index-B2-EFkfL.js`, SHA-256 matches local |
| live routes | `/`, `/privacy`, `/terms`, `/contact` → 200 |
| rollback target | `f7c9b7f8-59f8-4c3c-980f-51e8dd7710f4` |

The experimental recognition paths are off by default on the live site. The
mic semitone evidence is active by default and has no UI change.

Live acceptance: the same 21/21 experimental-vision flow passed against
`https://corranzo.com/` in Chromium on the deployed bundle (local and live
SHA-256 match).


### Round-2 deployment status

No new live deployment was made in this round (overnight deployment
authorization was not explicit). The live site remains version
`674f3939-e59f-46ec-94b2-d26e6e16ed54` / bundle `index-B2-EFkfL.js` from the
previous round. The verified round-2 bundle is `index-pcLGJ7oV.js`; it is
deployment-ready but not live. If deployed, the rollback target is
`674f3939-e59f-46ec-94b2-d26e6e16ed54`.

## 7. Round 3 — Audio corrections integrated; Piano/Guitar held

**Live at round-3 start:** Worker
`94122c75-aaff-46fd-b24e-fad7908bb9b6`, bundle `index-pcLGJ7oV.js`. The
round-2 experimental bundle was deployed after the previous report by another
authorized deployment; it remains the live baseline.

**Integrated this round:** Audio Vision v3 note corrections, in three reviewable
commits:

- `f4fb61a2c7` — v3 data model + storage + 34 tests.
- `c610ac7afd` — pipeline/hook/saved metadata + 12 product-path tests.
- `870777bb91` — review editor UI + 20/20 real Chromium acceptance.

See `docs/audio-vision-corrections-v3-integration-2026-10-25.md`.

**Not integrated:** Piano `bd143648b0` and Guitar `48a5790f7e` /
`6683d65e3b`. Both remain experimental and practice-disabled.

- Piano audit: `docs/piano-vector-structural-audit-2026-10-25.md`.
  Candidate reproduces 349/447, grand 88/88 and dashed rest 6/6, but
  equal-pitch slurs and cross-staff curves become ties, decorative curves can
  remain practice-open, and the old rest false-acceptance survives. No
  production change.
- Guitar audit: `docs/guitar-vision-mixed-rhythm-audit-2026-10-25.md`.
  `6683` fixes 18→21 noteheads and 60/60 string/fret, but the mixed page still
  has 0 confident onsets, all placeholder quarters and 0/4 valid measures.
  No production change.

**Round-3 regression:** full suite **4002 passed, 19 skipped, 0 failed**;
PDF-first **4 / 4**; Audio Vision critical **19 / 19**; Audio note editor
**21 / 21 Chromium** and **21 / 21 WebKit** on the built bundle; experimental
Vision **24 / 24 Chromium** and **24 / 24 WebKit**; unified WebKit **12 / 12**;
unified mic practice **23 passed, 0 failed, 1 skipped**.

**Round-3 local bundle:** `dist/assets/index-ks2_w5OX.js`, SHA-256
`2007f8939497160e25544dca0fa103f33846c541e527a256ef7f483a8445a70e`.
Not deployed. If deployed, rollback target is
`94122c75-aaff-46fd-b24e-fad7908bb9b6`.

## 8. Round 4 — Guitar text runs integrated; Piano safety repair rejected

**Live at round-4 start:** Worker
`0ccc559c-10d5-43df-92db-42a5715790cb`, bundle `index-ks2_w5OX.js`
(SHA-256 matches the round-3 local build). The round-3 Audio Vision v3 editor
is live; the older round-2 bundle is no longer production.

**Integrated:** `d31a569572` — isolated Guitar `notationNoteheads` text-run
splitting from `6683d65e3b`, plus strict unknown-rhythm protection. Mixed fixture
goes 18→21 noteheads and 60/60 string/fret, but everything remains
`duration:null`, 0 confident onsets, 0/4 valid measures, `rhythm_recovered`
false and practice disabled. Paired/techniques remain 116/116 and 32/32 with
8/8 measures; sparse abstains. No stem/beam changes from newer research were
imported. See `docs/guitar-vision-mixed-rhythm-audit-2026-10-25.md`.

**Not integrated:** Piano `723b47847c`. The arithmetic rest promotion is now
correctly denied, but our own controls still find practice-enabled false
acceptance for equal-pitch short slurs, same-staff two-voice sums and decorative
short curves; path accidentals remain unverified. See
`docs/piano-vector-safety-repair-audit-2026-10-25.md`.

**Round-4 local bundle:** `dist/assets/index-DJy6qAU3.js`, SHA-256
`79808654cb4a4ba3a46eb9f19de9a4a957b51cf46d53722c7a7e9166eb0bcf06`.
Not deployed. Rollback target if deployed:
`0ccc559c-10d5-43df-92db-42a5715790cb`.

## 9. Round 5 — Guitar stem probe scoped; Piano ownership rejected

**Live at round-5 start:** Worker
`8748583b-da41-4f0c-be52-6d133da94185`, bundle `index-DJy6qAU3.js`. Its
SHA-256 matches the round-4 local build; Audio Vision v3 and the round-4 text
run split are live.

**Integrated:** `248a20b5bd` — edge+centre stem starts for TAB `attachRhythm`
only. The new half-note fixture PDF is included. Mixed result: 21/21 noteheads,
60/60 string/fret, **15/21 confident onsets**, **3/4 valid measures**, 15
complete timed events; the 16 events in measure 3 remain `duration:null` and
carry the explicit placeholder footnote. `rhythm_recovered=false`; practice
disabled. Paired/chords and techniques remain 32/32 and 8/8. Sparse abstains.

The probe was **not** applied to `analyzeNotationRhythm`: doing so changed the
notation-only fixture from 16 eighths + 24 quarters to 40 quarters. That
diagnostic keeps the old edge-only probe and remains exact.

**Not integrated:** Piano `b4f6dce882`. It reproduces 377/447, tuplets 62/63,
grand 88/88 and dense 195/264, and exclusive path ownership is an improvement.
But equal-pitch short slurs, same-staff two-voice sums and decorative short
curves still open practice; a decorative `3` marker can mark six notes as
tuplets; path key-region/decorative accidental safety remains unproven. See
`docs/piano-vector-safety-repair-audit-2026-10-25.md`.

**Round-5 local bundle:** `dist/assets/index-BVw0gRmn.js`, SHA-256
`c284e708158a83607243cf651730449a090ad07db3ae2969b3350a12678880ea`.
Not deployed. Rollback target if deployed:
`8748583b-da41-4f0c-be52-6d133da94185`.

## 10. Round 6 — independent acceptance and voice-gate hardening

**Live at round-6 start:** Worker
`d367ee53-3cf6-4d1f-9117-36b9bc3b69a1`, bundle `index-BVw0gRmn.js`
(SHA-256 matches the round-5 build).

**Integrated product safety:** Piano practice eligibility now requires
`voiceOwnership === 'verified'`. Current extraction reports only `staff-only`
ownership, so the experimental Piano path is preview-only even where note/rest
and measure counts are complete. This closes the corrected-beginner promotion
observed during round-6 evaluation and the same-staff multi-voice false
acceptance. `scripts/vision-piano-adversarial-audit.mjs` refuses 10/10 controls
against production.

**Evaluation improvements:** corrected CC0 Piano fixtures are kept separately;
the canonical evaluator now reports note, rest, pitch-only, duration-only,
full-event, measure, abstention and practice fields. Independent Verovio
engravings (grand/rhythm/pickup-crossstaff) are held separately and must abstain
from the vector route.

**Not integrated:** Piano `0607fac9d7` / `b4f6dce882`. The corrected corpus
reproduces 378/447 for the candidate (not the historical 377) and three
candidate practice-ready scores, but the candidate still fails equal-pitch
slur, same-staff multi-voice and decorative-curve controls. No extraction port.

**Guitar:** `3b755220af` changes fixture artwork only; current recognition
remains 21/21 noteheads, 15/21 confident onsets and 3/4 valid measures, with
measure 3 explicitly null. No recognition code change.

**Round-6 local bundle:** `dist/assets/index-nUlncSNZ.js`, SHA-256
`8c8b5b165596299dc381ac7fef89a2327520c227f271dc26f4ca5061c6693402`.
Not deployed. Rollback target if deployed:
`d367ee53-3cf6-4d1f-9117-36b9bc3b69a1`.
