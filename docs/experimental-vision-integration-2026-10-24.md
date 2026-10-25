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
