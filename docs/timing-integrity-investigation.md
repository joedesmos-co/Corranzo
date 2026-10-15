# Timing-integrity investigation — H1/H2 overfull measures (2026-10-13)

Branch: `codex/score-follow-precision` (worktree
`~/Documents/scoreflow-scorefollow-precision`), based on `bad9f98e18`
(which already contains `fcdb8d017269` main). Sound Engine checkout
untouched at `c4940fd6f9` on `codex/notation-aware-audio`.

Scope: the documented H1/H2 timing problem — overfull or voice-flattened
MusicXML placing notes from neighboring written measures into one Wait For
You (WFY) checkpoint, while the cursor follows playback correctly. No
gradual-tempo, latency, or mic work. No cursor offsets were introduced to
hide timing; no notes were truncated, re-timed at runtime, or auto-overlapped.

---

## 1. Frozen-set trace (before any change)

`scripts/measure-timing-integrity.mjs` traces a small frozen set through the
shipped pipeline: source MusicXML → parsed onsets → written measure windows →
performed timeline → WFY note checkpoints. Written-measure identity is kept
distinct from performed time (a note's `measureNumber` vs the window its
performed time falls in).

Frozen set: two valid multi-voice controls (`guitar-spanish-romance`: voices +
backup + 270 tuplets; `piano-mozart-turkish-march`: voices + backup + tuplets),
one ties control (`piano-brahms-lullaby`), one synthetic control (pickup,
repeat, tie across barline, tuplet, two voices with backup, chord), and the
three malformed voice-flattened scores (BWV 846 prelude, Aguado a-minor,
BWV 999).

Baseline measured against **pristine HEAD `bad9f98e18`** in a separate
worktree (`tmp/timing-integrity/report-before.json`):

| score | role | measures | overfull | worst excess | cross-measure WFY checkpoints | drift past own barline |
|---|---|---|---|---|---|---|
| guitar-spanish-romance | control | 32 | 0 | 0q | 0 (0.0%) | 0q |
| piano-mozart-turkish-march | control | 128 | 0 | 0q | 0 (0.0%) | 0q |
| piano-brahms-lullaby | control (ties) | 16 | 0 | 0q | 0 (0.0%) | 0q |
| synthetic-control | control (pickup/repeat/tie/tuplet/voices/chord) | 5 | 0 | 0q | 0 (0.0%) | 0q |
| piano-bach-prelude-bwv846 | malformed (H2) | 35 | 34 | 3.75q | **34 (7.1%)** | 3.75q |
| guitar-aguado-a-minor-study | malformed (H1) | 16 | 16 | 3.0q | **39 (19.9%)** | 3.0q |
| guitar-bach-prelude-bwv999 | malformed (same class) | 43 | 42 | 1.25q | **42 (9.1%)** | 1.25q |

Every overfull measure of the three malformed scores is voice-flattened:
BWV 846's lower part holds 7.5 quarters of sequential content per 4/4 bar
(C half, E, C half, E — no `<voice>`, no `<backup>`, no `<chord>`), so
measure N's notes sound during windows N+1/N+2 (cumulative drift — m2's
notes sound at t≈9.75 s inside m3's window at ♩=60, matching the upstream
handoff). Aguado's single part interleaves a bass voice and a 16th-note
arpeggio voice end-to-end (7.0q per 4/4 bar). WFY's 1 ms onset grouping then
merges notes written in different measures into one checkpoint — 34/39/42
checkpoints require notes the printed score never shows together, so they can
never be satisfied and practice stalls. Controls: zero of anything.

## 2. Error-source table (parser behavior vs file defect)

The parser is faithful to each file's semantics: it sequences notes by
duration exactly as MusicXML prescribes (no voice, no backup → one stream),
advances the cursor past the barline, and records both the notated extent
and the time-signature window. The defect is in the FILES (upstream export),
not in the parser's semantics.

| class | evidence in file | scores (overfull measures) | error source | disposition |
|---|---|---|---|---|
| `unvoiced-flattened` | no `<voice>`, no `<backup>` anywhere in part | piano-bach-prelude-bwv846 (34), guitar-aguado-a-minor-study (16), guitar-bach-prelude-bwv999 (42) | file defect (music21 MIDI→MusicXML flattening) + authoritative MIDI bundled | **repaired** (§4) |
| `backup-but-unvoiced-seq` | file uses voices/backups elsewhere; the overfull measure lost both | guitar-aguado-allegro-g (2), favorites-1 (3), op03-1 (1), op03-3 (2), op03-4 (3), op03-5 (4), piano-bach-fugue-bwv846 (4), piano-chopin-mazurka-op6-1 (16), piano-handel-gavotte (2), piano-tchaikovsky-old-french-song (15) | file defect; bundled MIDI is voice-interleaved or performance-quantized and does NOT match note-for-note | **flagged + fallback** (§3) |
| `voiced-without-backup` | `<voice>` tags present, no backup in measure | (subsumed above; op03-* measures) | file defect (voice split unrecoverable from onsets alone) | flagged + fallback |
| `voiced-with-backup` | voices + backups present, a voice still exceeds the window | op03-1 (3), op03-2 (2), op03-4 (2), op03-5 (2), op03-6 (2), piano-beethoven-fur-elise (1), piano-chopin-mazurka-op6-1 (1) | file defect (extra/misplaced notes; MIDI mismatch, incl. one-excess-32nd measures such as Für Elise m26, 1.583q in a 1.5q window) | flagged + fallback |
| parser error | — | none found | — | — |

MIDI consistency was established by note-for-note matching (pitch + written
duration, per measure window, onset clusters) in
`scripts/repair-flattened-practice-musicxml.mjs --check-all`. Three scores
match their bundled MIDI exactly (the three repaired below). Every other
overfull score's MIDI either disagrees note-for-note (voice-interleaved
document order and/or humanized durations, e.g. Turkish March MIDI 0.443q
where the file says 0.5q) or lacks the notes — repairing from them would be
guesswork and was refused by design.

## 3. Validation + honest practice fallback (code)

**New** `src/features/musicxml/timingValidation.js`:
- `validateMeasureTiming(measures, partMeasureNoteEnds)` compares each
  (part, measure)'s written NOTE-content extent (new parser field
  `notatedNoteEndQuarters`, computed pre-tie-merge so legitimate ties across
  barlines never count) against the time-signature window.
- Result: `{ status: 'valid' | 'invalid', overfullMeasures: [...], summary }`
  with per-measure classification (table above), excess quarters, voice tags,
  backup presence. Attached to every parse result as `timingValidation`;
  `getTimingValidation` recomputes for timing maps built elsewhere (OMR).
- Pickups, ties across barlines, and tuplets are never flagged (unit-tested).

**WFY fallback** (`waitForYouCheckpoints.js`): when validation is `invalid`,
simultaneous onset groups that span more than one WRITTEN measure are split
by written measure — one checkpoint per printed measure. Same-measure
cross-staff groups (a piano grand staff's chord) stay merged, so piano chords
are never broken. Valid scores are untouched: legitimate cross-measure
simultaneity and cross-measure ties keep their single checkpoint (tie
continuations are folded before grouping and can never be split). Nothing is
re-timed, truncated, or dropped: the performed times stay exactly as parsed
(the follow layer keeps flagging the split-brain via `measureMismatch`), and
checkpoint ids stay unique for WFY's one-shot consumption.

**Honest surfacing**: `describeSourceFidelity` now reports
`timing-invalid:overfull-measures:<n>`; `useWaitForYou` exposes
`timingValidation`/`timingNotice`; the WFY panel shows musician copy
("This score's file has N measures with more notes than fit…") when a score
is invalidated. `scoreFollowPrecisionDiagnostics` additionally treats a
checkpoint landing within 11 ms of its OWN written measure window start as
barline dust (not overflow) — repaired files produce zero phantom overflow.

## 4. File repair from the authoritative bundled MIDI

Provenance: `scripts/import-practice-library.mjs` downloads a Mutopia MIDI
and converts MIDI → MusicXML with music21; the flattening is a conversion
artifact of that step, and the MIDI remains the authoritative in-bundle
source (verified: the MIDI's onsets differ from the flattened file's, so it
is not derived from the defective file).

`scripts/repair-flattened-practice-musicxml.mjs` re-times flattened parts
from that MIDI:
- pitches and WRITTEN durations preserved 1:1 (types, dots, beams, ties,
  articulations, accidentals verbatim; only onsets and voice structure move);
- onsets restored from MIDI note-on ticks;
- voice split derived deterministically by non-overlap coloring with
  `<backup>` + padding rests as positioning mechanics only;
- non-note children (attributes, directions, barlines, prints) keep their
  document position; untouched parts stay byte-identical;
- refuses to write unless pre-write verification passes: reparses, zero
  overfull measures, note multiset preserved, and every parsed onset equals
  its MIDI onset (per measure window).

Repaired (git-tracked fixtures; provenance comment + preserved rights):
- `piano-bach-prelude-bwv846` (34 measures, lower part only — upper part
  already valid), `guitar-aguado-a-minor-study` (16),
  `guitar-bach-prelude-bwv999` (42).
Example, BWV 846 m1 lower: voice 1 = C half @0, C half @2; voice 2 = 16th
rest + double-dotted quarter @0.25, repeat @2.25 — the true two-voice
texture, with the file's original durations/types.

## 5. Before/after results

Checkpoint/drift trace (`tmp/timing-integrity/report-before.json` vs
`report-after.json`):

| score | cross-measure checkpoints | split-by-fallback | overfull | worst drift |
|---|---|---|---|---|
| piano-bach-prelude-bwv846 | 34 (7.1%) → **0** | — (repaired) | 34 → **0** | 3.75q → **0q** |
| guitar-aguado-a-minor-study | 39 (19.9%) → **0** | — (repaired) | 16 → **0** | 3.0q → **0q** |
| guitar-bach-prelude-bwv999 | 42 (9.1%) → **0** | — (repaired) | 42 → **0** | 1.25q → **0q** |
| controls (4) | 0 → 0 | 0 | 0 → 0 | 0q → 0q |

WFY checkpoint counts after repair (correct timing separates previously
merged onsets): BWV 846 479 → 545, Aguado 196 → 235, BWV 999 463 → 505.

Node precision harness (`scripts/measure-score-follow-precision.mjs`,
24 scores / synthetic-anchor consistency — not printed-ink truth):

| metric | before | after |
|---|---|---|
| scores ok | 24/24 | 24/24 |
| checkpoints | 8843 | 9046 |
| max onset error (page) | 0.4613 (La Campanella, pre-existing overflow class) | 0.4613 (unchanged) |
| max agreement error (page) | 0.4534 | 0.4444 |
| wrong page / system / NaN / invisible / backward | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 |
| jumps explained | 107/107 | 107/107 |
| teleports | 0 | 0 |

Per repaired score (onset max / agreement max / overflow samples):
- BWV 846 prelude: 0.0167 → **0.0059** / 0.0060 → **0.0056** / 34 → **0**
- Aguado a-minor: 0.0497 → **0.0128** / 0.0498 → **0.0128** / 96 → **0**
- BWV 999: 0.0116 → **0.0047** / 0.0105 → **0.0096** / 126 → **0**
- Fugue BWV 846 (NOT repaired — flagged): overflow 26 → 20 honest flags on
  387 split checkpoints; onset/agreement max unchanged (0.0373/0.0303).
  It remains the only score with flagged overflow — reported separately,
  never averaged.

Cross-engraving harness (`scripts/measure-cross-engraving.mjs`, real PDF
pairs, zero synthetic anchors):

| pair | onset max (page) | agreement max | overflow | checkpoints | teleports | wrong page |
|---|---|---|---|---|---|---|
| Für Elise (Breitkopf 1888) | 0.0105 → 0.0105 | 0.0105 → 0.0105 | 0 → 0 | 619 → 619 | 0 | 0 |
| BWV 846 (OpenGoldberg CC0) | **0.6230 → 0.0208** | **0.6230 → 0.0208** | 32 → **0** | 479 → 545 | 0 | 0 |

Both pairs still auto-setup `plausible + approximate + layoutMismatch` and
the UI keeps saying "Approximate — measure barlines" — approximate labels
preserved; the BWV 846 improvement comes from the file repair, not from any
new mapping claim.

Browser acceptance (deterministic MIDI injection where input is needed):
- `browser-unified-practice-midi-e2e` **26/26** — WFY correct/wrong/partial-
  chord/repeated-note/duplicate behavior, cursor lock on the required
  notehead, preview play/pause/seek, loop, score-change reset (assertion
  updated 1-of-479 → 1-of-545 for the repaired prelude), zoom, zero console
  errors.
- `browser-cross-engraving-e2e` **7/7** — real PDF+MusicXML upload, MusicXML
  tempo wins (♩=72), approximate labels, seek/zoom stable, WFY lock
  co-located.
- `browser-score-follow-precision-e2e` **9/9** — onset lock mean 8.52
  staff-spacings / max 19.48 (gate: ≤0.6 event spacing), pause freeze,
  seek relocation, WFY lock, zoom.
- `browser-practice-score-follow-e2e` **17/17**;
  `browser-tempo-acceptance-e2e` **5/5** (measures at the notated 3.0 s,
  startup offset 0.08 s, static onset error 7.4 px).

Unit suite: **3559 passed / 7 failed** — the same 7 pre-existing UI-copy
assertions that fail identically on the pristine baseline (the baseline
worktree additionally showed one environment-flaky Playwright test,
`practiceVisualRuntime`, which fails on pristine HEAD there and passes on
this branch). New: `tests/timingValidation.test.js` (14 tests: validation,
classifications, pickup/tie/tuplet non-flagging, split fallback, note
preservation, grand-staff chords intact, cross-measure tie intact, source
fidelity, musician copy). `npm run test:scripts` green; `npm run build`
green; lint unchanged (all remaining lint errors pre-exist on baseline).

Untracked artifacts: the eight pre-existing `tmp/` artifact directories were
preserved byte-for-byte (`diff -r` verified); new evidence (reports +
screenshots) is under `tmp/timing-integrity/` (also untracked).

## 6. Finding for the next slot (pre-existing, not fixed here)

**F1 — tie durations double-merge into checkpoint heads.** The parser
correctly folds a tie chain into its head (`applyTieSustainToNotes`: head
2q + continuation 2q = 4q), then `mergeTiedContinuations` in
`waitForYouCheckpoints.js` adds the continuation AGAIN (head reports 6q).
Repro: parse any score with a tie (e.g. the 2-measure fixture in
`tests/timingValidation.test.js`'s `flattenedWithTieScore`) and compare
`timingMap.notes[i].durationQuarters` (correct) with the checkpoint head's
(correct + continuation). Affects WFY hold/plateau math and reference
playback on every tied score. Left untouched this round to keep the H1/H2
before/after evidence clean; it is the next focused blocker together with
the flagged-file list.

## 7. Remaining flagged scores (malformed-file cases, reported separately)

Validation-invalid, fallback active, repair refused (MIDI not authoritative
for the file): guitar-aguado-allegro-g, guitar-aguado-favorites-1,
guitar-aguado-op03-1…6, piano-bach-fugue-bwv846,
piano-beethoven-fur-elise, piano-chopin-mazurka-op6-1,
piano-handel-gavotte, piano-tchaikovsky-old-french-song (47 overfull
measures total across 13 scores; worst single excess 4.0q). These need
re-export from an authoritative source (see handoff update) — not a
follow-layer change.

## 8. What was deliberately NOT done

- No runtime re-timing, auto-overlap, voice guessing, duration truncation,
  or bar normalization in the parser.
- No cursor offsets to hide drift; no suppression of legitimate
  cross-measure ties/repeats (validated by tests).
- No new mic thresholds, sound changes, velocity layers, filters, gradual
  tempo, or latency compensation.
- Physical microphone tests and musician listening remain pending and
  unlabeled as accepted; the top-register piano sharpness finding from the
  Sound Engine slot is untouched.
