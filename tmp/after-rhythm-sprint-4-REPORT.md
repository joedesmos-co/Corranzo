# Rhythm Sprint 4 Report — Dense chords + flags/partial beams

Evaluator: **frozen** `2.0.0` / schema `2` (untouched).  
Compare: `tmp/after-rhythm-sprint-3.json` → `tmp/after-rhythm-sprint-4.json`  
Gate: **ACCEPT: YES**

## Scoreboard

| Metric | Sprint 3 | Sprint 4 | Δ |
|--------|----------|----------|---|
| Overall | 50.7% | 50.8% | +0.08 pp |
| **Rhythm** | **62.7%** | **63.3%** | **+0.59 pp** |
| Pitch | 16.7% | 16.7% | −0.03 pp |
| Sustain | 55.8% | 55.8% | 0 |
| Articulation | 68.5% | 68.5% | 0 |
| Measure structure | 51.0% | 51.0% | +0.01 pp |
| Interpretation | 0.0% | 0.0% | 0 |

### Targeted defects

| Defect | Sprint 3 | Sprint 4 | Δ |
|--------|----------|----------|---|
| **duration-mismatch** | **149** | **146** | **−3** |
| **onset-mismatch** | **135** | **129** | **−6** |

No semantic class mean dropped >1 pp.

## Per-fixture Rhythm

| Fixture | Sprint 3 | Sprint 4 | Δ |
|---------|----------|----------|---|
| **piano-dense-advanced-vector** | 38.5% | **43.8%** | **+5.33 pp** |
| all others | — | — | 0 |

## RCA summary

### Dense chord sequentialization

Trace: notehead columns → grouping → onset snap → gap duration → coalesce → MusicXML `<chord/>`.

**Findings:**
1. Same-onset fragments often got **different gap durations**, so `coalesceSameOnsetChordEvents` (old `start:clef:duration:cxBucket` key) never merged them.
2. `splitChordToneCandidate` required **≥3** chord tones, so common **2+1** stacks stayed sequential.
3. Many dense orphans were **mis-clef’d** onto the opposite staff; cross-clef merge helped grand-staff duration sync in trials but **regressed dense** when applied broadly — not shipped.
4. Dominant dense pattern: multi-note attacks on **odd sixteenth slots** vs truth **eighth-grid** unbeamed chords → cursor/onset cascade.

### Flags / partial beams

- Truth dense chords are **unbeamed eighths**; tuplet m2 is **flagged 16ths**.
- Loose flag probes (primary≈2 tip noise) false-fired on quarters → **not wired into `countBeams`**.
- `countFlags` exists for double-flag detection (unit-tested) but is **not applied in enrich** this sprint (single-flag path caused guitar-standard regressions in trials).
- Partial/secondary beams remain on the Sprint 2 `hasSecondaryBeamRow` path; no darkness/`beamStrength≥14` sixteenths.

## Root causes fixed

1. **Duration-agnostic same-clef coalesce** — same onset + tight cx merge even when gap durations differ; take max duration.
2. **2+1 split-chord reattach** — anchor ≥2 notes, gap=1, allow shorter orphan; skip beamed followers / inner-voice splits.
3. **`resnapDenseChordOnsets`** — for chord-dominated **grand-staff** dense measures without dominant primary/secondary beam texture, snap odd multi-note onsets to the eighth grid and re-gap per clef.

## Rejected / narrowed

- Flag→beams in production enrich (guitar-standard −6 pp).
- Broad cross-clef coalesce/reattach (dense −2–3 pp).
- Ungated dense eighth resnap (tuplets / guitar-standard regressions).

## Remaining dominant rhythm failures

- **duration-mismatch (~146)** and **onset-mismatch (~129)** still lead.
- **TAB packing** (`guitar-tab-sparse` R=17%, onset-heavy).
- Residual dense/split-measure alignment; false staff mapping still limits chord integrity.
- True **flagged sixteenths** still lack a safe production flag path.
- Duration→onset cascades outside gated dense grand-staff measures.

## Code touched

- `src/features/omr/processVectorOmrPage.js` — coalesce, `resnapDenseChordOnsets`
- `src/features/omr/reconstructMusicalEvents.js` — 2+1 split-chord
- `src/features/omr/detectNoteRhythmFeatures.js` — `countFlags` helper (not production-wired)
- Tests: `tests/omrChordGrouping.test.js`, `tests/detectNoteRhythmFeatures.test.js`

Not touched: evaluator, ActiveScore, ties/sustain, articulations, repeats, dynamics, playback realism.
