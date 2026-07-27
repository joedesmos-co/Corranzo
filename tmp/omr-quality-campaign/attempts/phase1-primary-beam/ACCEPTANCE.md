# Phase 1 — Primary Beam Topology Promotion: ACCEPTED (after narrowing)

## Decision

ACCEPTED with one narrowing added during the acceptance audit:
written-duration overrides now require beam confidence >= 0.9
(`MIN_DURATION_OVERRIDE_CONFIDENCE`), while beam-tag grouping keeps the 0.7
floor. Scope evaluated at the frozen baseline scope (mode written; 1 page for
sprint-5 sources and fixtures; 2 pages for La Campanella, Fantaisie-Impromptu,
Moonlight 3, Hungarian Dance No. 5, Carol of the Bells).

**Manual browser review (2026-07-27): PASS** on Carol, Evangelion,
Fantaisie-Impromptu, Guitar standard chords, and piano-articulation-scan.
`MIN_DURATION_OVERRIDE_CONFIDENCE = 0.9` is frozen. Details:
`tmp/omr-quality-campaign/phase1-manual-review/MANUAL_REVIEW.md`.

## What the candidate does

- `applyVectorPrimaryBeamTopology` promotes connected primary-beam groups from
  the diagnostic beam/stem graph into shared vector-event semantics:
  written duration correction (never against dot/hollow evidence, never on
  tuplets, only level-1 beams, single-group ownership, >= 2 members at >= 2
  distinct onsets).
- `buildMeasureBeamValues` gained `eventsShareBeamTopology` so contiguous
  events from different detected groups are not joined into one beam.

## The unfinished safety question — answered

“Are the extra beam tags correct recovered notation or new false noise?”

The original probe counted 7 falseBeamedNotes (all Carol). Root cause of the
metric: MusicXML encodes a chord's beams only on the first chord note; truth
and candidate order chord tones differently, so midi-paired notes miscount
identical visual beams as false+mismatch pairs. After chord-normalized
comparison (every note inherits its chord group's beam signature):

- correct beam signatures: 6 -> 159 (of 284 beamed truth notes)
- beam mismatches: 278 -> 125
- false beamed notes: 2 (baseline) -> 3 (candidate)

The one net-new false label (Carol m14/m56 pair) was traced to real printed
beam pairs (verified against PDF crops of Carol p1 systems 2–4, p2 systems
m48/m54/m60) whose parsed onsets sit a half-beat off due to pre-existing
duration/rest errors in those measures; the printed page shows exactly one
beam pair per staff where the candidate emits exactly one. No control fixture
(articulation-scan, tuplets, grand-voices, dense-advanced, gymnopedie,
minecraft, moonlight, campanella) gained any false beam.

## Guitar regression found and fixed during this audit

The pre-gate candidate regressed `guitar-standard-chords-vector` rhythm
0.4661 -> 0.4492 on the frozen corpus: measure 1 gained two
“Quarter detected as eighth” defects. Root cause: the fixture's slash-flag
strokes bridge closely spaced stems, the tip-to-tip ink probe accepted the
connection (confidence 0.86), and the terminal-member rule floored a true
quarter chord to an eighth. Every legitimate duration adjustment in Carol (3)
and Evangelion (17 applications; 3 scored fixes) carries confidence 0.92 —
the fully-connected thick-bar signature. The 0.9 duration-override gate keeps
all real fixes and exactly restores the guitar fixture to its baseline
defects. Regression test added
(`never overrides written durations below full beam-bar confidence`).

## Real-score results (12-source scope, frozen evaluator authority)

- wrongNoteDuration: 418 -> 412 (-6; zero introduced anywhere)
  - Evangelion: 3 missing-dot fixed (m1, m3, m72) — dotted-eighth recovery
  - Carol: 3 duration-mismatch fixed (m14 x2, m26) — eighth-as-quarter
- wrongRestDuration / missingRest / inventedRest / denseChordSeparation /
  tupletGrouping: unchanged
- Note counts, MIDI pitch inventory, parsed attack order, frozen notation
  semantics (ties, slurs, articulations, accidentals): unchanged on all 12
- Playback score: 100% -> 100% on all 12 (evaluator playback class)

## Frozen gates

- Frozen semantic corpus vs dense-rhythm-after: all class deltas exactly 0,
  zero regressions (comparator ACCEPT:NO is the neutral no-scored-change
  answer, as in the accepted dense-rhythm sprint).
- Full vitest suite: 2636 passed / 9 failed — the same 9 pre-existing
  dirty-worktree failures (demoFixtures, omrNegativePage x2, omrTieRecall x3,
  productFixes, scoreSourceGenerationGate, tabLaneLayout), verified identical
  with Phase 1 wiring disabled via a temporary A/B guard.
- Notation Fidelity Sprints 2–5 + Musical Structure Sprint 1: pass.
- Production build: pass. Targeted lint: clean (removed two functions in
  processVectorOmrPage.js orphaned by earlier sprint edits).

## Files

- src/features/omr/applyVectorBeamTopology.js (new; + 0.9 duration gate)
- src/features/omr/processVectorOmrPage.js (wiring; dead-code removal)
- src/features/omr/buildOmrMusicXml.js (beam-group boundary gating)
- tests/vectorBeamTopology.test.js (6 tests incl. flag-bridge regression)
- scripts/omr-quality-campaign-probe.mjs (audit harness)
- tmp/omr-quality-campaign/audit-phase1-chordnorm.mjs (chord-normalized audit)

## Evidence

- evidence/carol-p1-system2-m8-14.png, -system3-m15-20.png, -system4-m21-26.png
- evidence/carol-p2-system-m48-53.png, -m54-59.png, -m60-end.png
- evidence/guitar-standard-chords-top.png (flag-bridge source)
- evidence/carol-m14-gallery.png (PDF -> baseline -> candidate)
- comparison.json (final), comparison-pre-gate.json (pre-narrowing record)
- frozen-corpus.json / frozen-corpus.txt
