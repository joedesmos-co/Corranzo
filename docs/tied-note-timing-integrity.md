# Tied-note timing integrity (2026-10-14)

Branch: `codex/score-follow-precision` (worktree
`~/Documents/scoreflow-scorefollow-precision`), based on `ec50a03cdd`.
Timing-integrity repairs and validation behaviour from the previous round are
preserved and re-verified below. No new worktrees, no downloads.

Scope: tied-note duration accounting end to end (MusicXML → timing →
checkpoints → Preview / WFY / Play Along), plus the universal-score
acceptance evidence the mission added. No sound changes, no gradual tempo, no
latency or mic work.

---

## 1. Commits

| Commit | Content |
|---|---|
| `TIE-1` | **fix(score-follow)**: correct tie-chain duration accounting (parser chain bookkeeping + no double count in checkpoints), 14 unit tests, tie-duration trace harness |
| `TIE-2` | **feat(score-follow)**: unseen-score + holdout-PDF acceptance harnesses; classify the known practice-clock warning in the cross-engraving gate |
| `TIE-3` | **docs**: this report + links from the previous timing-integrity doc |

## 2. Exact tie root cause (F1, from the previous round)

`applyTieSustainToNotes` (parser) merges a tie chain into its head and marks
continuations `suppressPlaybackAttack`. `mergeTiedContinuations`
(`waitForYouCheckpoints.js`) folded the same continuations into the checkpoint
head **and added their durations again** — the head's `durationQuarters` /
`durationSeconds` were already the chain total.

Repro (2q tied to 2q in one bar):

| layer | duration before | after |
|---|---|---|
| parser `timingMap.notes` head | 4.0 q (correct) | 4.0 q |
| WFY checkpoint head | **6.0 q** | 4.0 q |
| visual-lane group head | **6.0 q** | 4.0 q |
| multi-measure chain 1q+1q+2q | **7 q** (both continuations added) | 4 q |
| Brahms lullaby (39 chains) | 38 chains inflated by +1 q each | correct |

Second defect found while fixing it (same family, not previously known):
`mergeTiedContinuations` resolved the head by part/voice/pitch only, so a
tie-stop from a **different** chain was folded into an unrelated same-pitch
chain — 52 chains across 7 library scores drew a sustain bar across unrelated
measures (Aguado op03-4/5, Chopin mazurka, fugue BWV 846, Tchaikovsky). Chain
identity is now exclusive via `tieChainId`.

Third defect (general MusicXML handling): `<voice>` is optional, so a
voice-less tie-stop defaulted to voice 1 and never found its voice-2 head —
the note stayed an un-merged **re-attack** (165 dangling tie-stops across the
library). Pairing now prefers the exact voice, then the most recently opened
same-pitch chain in the same part, gated on a new `voiceDefaulted` flag that
records that the source omitted `<voice>`. No voice is invented; timing only.

Fixes: explicit chain bookkeeping at parse time
(`writtenDurationQuarters`, `tiedChainDurationQuarters`, `tieChainNoteCount`,
`tieChainSerial`), and the checkpoint fold now **re-states** the head duration
from the chain record instead of accumulating — idempotent by construction.

Library-wide after: **433 tie heads / 419 continuations, 0 duration
mismatches, 0 mis-folds, 0 ambiguous chains, 19 dangling tie-stops** (all in
flagged malformed files where no head exists to pair with; reported, not
guessed).

## 3. Duration before/after (all layers agree)

`scripts/measure-tie-duration-integrity.mjs` — 11/11 cases:

| case | parser | WFY | lane |
|---|---|---|---|
| tie within a measure (2q+2q) | 4 → 4 | **6 → 4** | **6 → 4** |
| tie across a barline | 4 → 4 | **6 → 4** | **6 → 4** |
| multi-measure chain (1+1+2q) | 4 → 4 | **7 → 4** | **7 → 4** |
| partially tied chord | 4 → 4 | **6 → 4** | **6 → 4** |
| two voices, independent chains | 4,8 → 4,8 | correct | correct |
| whole chord tied (3 tones) | 4,4,4 | correct | correct |
| repeated same pitch, no tie | 2 attacks | correct | correct |
| two separate same-pitch chains | 2,2 | correct | correct |
| tie over a tempo change | 4 q / 3 s | correct | correct |
| slur (not a tie) | 2 attacks | correct | correct |
| library score (Brahms lullaby, 38 chains) | 38 values | correct | correct |

Cross-layer onset identity is also asserted: checkpoint times, visual-lane
group times, and playback (performed-timeline) onsets agree for every score
(checkpoints live on the documented 1 ms chord-alignment grid).

## 4. Multi-measure ties

1q+1q+2q chains merge to a single 4 q sounding note with one attack, one WFY
target, and one playback event; the continuation measures produce no
checkpoint of their own. Ties across barlines keep their written measure for
geometry while performing as one note (no cross-measure requirement is
created by a tie).

## 5. Chord and repeated-note behaviour

- Fully tied chords: every tone sustains, one attack per tone.
- Partially tied chords: the tied tone sustains; the untied chord mate keeps
  its written duration and its own attack; a re-struck tone in the next bar
  stays a separate attack.
- Repeated notes **without** ties remain separate attacks (never merged).
- Slurs never merge durations or attacks.
- Same-pitch tie chains never cross-absorb (chain-id identity).

## 6. WFY hold correctness

WFY has no note-duration hold requirement: matching reads expected pitches
with a 500 ms tone-accumulation window (`waitForYouNoteMatch.js` reads no
duration). The F1 defect therefore never produced an impossible note
combination — its real impact was inflated durations in: WFY checkpoint data,
tie sustain rendering, cursor plateau/glide profile, TAB/staff-lane sustain
rendering, Play Along targets, and the canonical-timing-contract diagnostics.
All are corrected. Reference playback ("Hear it") uses a fixed 0.55/0.7 s and
was never affected — noted as a separate fidelity gap, not claimed as fixed.

Pitch requirements themselves are verified unchanged: one target per chain,
correct required pitches, repeated-note targets intact, partial chords intact
(browser e2e: correct / wrong / partial / duplicate / rapid-duplicate all
green).

## 7. Preview / Play Along consistency

One canonical timeline drives all three modes; the tie harness asserts
checkpoint times == lane group times == playback onsets on every case and
every library score. The playback schedule plays each chain exactly once with
its sounding duration.

## 8. Browser results

| suite | result |
|---|---|
| `browser-unified-practice-midi-e2e` | **26/26** (correct/wrong/partial-chord/repeated/duplicate, cursor lock, pause/seek/loop, score change, zoom, zero console errors) |
| `browser-practice-score-follow-e2e` | **17/17** |
| `browser-tempo-acceptance-e2e` | **5/5** (3.0 s measures, startup 0.08 s, static onset 7.4 px) |
| `browser-score-follow-precision-e2e` | **9/9** |
| `browser-cross-engraving-e2e` | **7/7** (see §10) |

Node: precision harness 24/24, 9046 checkpoints, 0 wrong-page/system/NaN/
backward/teleports — identical to the previous round (no tie-induced drift).
Cross-engraving: Für Elise 0.0105 page, BWV 846 0.0208 page, overflow 0 —
unchanged. `npm run test:scripts` green, `npm run build` green.
Unit: **3573 passed / 7 failed** — the same 7 pre-existing UI-copy assertions
that fail identically on pristine `ec50a03cdd`.

## 9. Remaining invalid-score cases

13 library scores remain flagged (`timingValidation: invalid`) and keep the
per-written-measure WFY fallback: 0 cross-measure requirements on every one,
verified again this round. The 19 dangling tie-stops live only in these files
(op03-4/5, Tchaikovsky) where the source pairs a tie-stop with no reachable
head; the parser leaves them as attacks (no data loss) and WFY skips them
(no impossible requirement). None were silently repaired.

## 10. Hidden assumptions found / fixed, and one pre-existing finding

Fixed this round (all general, none score-specific):
- tie continuation durations counted twice in checkpoint heads;
- tie-chain identity by pitch only → exclusive `tieChainId` matching;
- voice-less tie-stops missing their voice-2 chain (re-attacks);
- harness ambiguity: same-measure grand-staff tie heads cross-matched when
  checking (checker fixed, not product code).

Pre-existing, **not** fixed (reported): the practice clock emits
`Maximum update depth exceeded` during playback on one real-PDF pair
(Für Elise). Evidence it is not a score-following regression: reproduces at
committed `ec50a03cdd` with this round's tie changes stashed, with the
timing-notice render disabled, and with the overfull split disabled; the
stack is the practice clock (`PracticeSessionContext` RAF tick +
`useScorePlayback` `flushTimeUpdate`); the same flow with the valid BWV 846
pair emits zero console errors. The repo already classifies this warning as
known-pre-existing in `browser-unified-practice-mic-e2e.mjs` (29 hits/90 s on
an unrelated branch, functionality unaffected); the cross-engraving harness
now tracks it the same way (recorded in `tmp/cross-engraving-browser/report.json`
as `knownPreExisting`), so the gate still fails on any other error.
**Next blocker: the practice-clock render-thrash.**

## 11. Integration requirements (universal score support)

Demonstrated automatic behaviour on scores not used to develop any fix —
`scripts/measure-unseen-score-acceptance.mjs` (35/35) and
`scripts/measure-holdout-pdf-acceptance.mjs`:

- **A. Existing library**: all 24 through the same checks — 11 valid,
  13 flagged, 0 cross-measure WFY requirements, 0 tie mismatches.
- **B. Independent unfamiliar scores**: 11 procedurally generated scores
  (2/4 pickup, 6/8 with mid-measure tempo change, polyphony + chord + tuplet,
  changing meters 3/4→4/4→5/4, all tie shapes incl. a voice-less stop,
  repeated notes, slur-not-tie, 60-measure multipage, 3 malformed variants).
  Onsets verified against ground truth re-derived per voice, never from the
  parser's own walk.
- **C. Same music, different page geometry**: 1 / 4 / 8 systems per page on
  the 60-measure score — 180 checkpoints and identical checkpoint times in
  all three, pagination 15 / 4 / 2 pages. Musical timing is geometry-invariant.
- **D. Same music, different engraving**: the two real cross-engraving pairs
  (Für Elise Breitkopf 1888 vs Mutopia-derived; BWV 846 OpenGoldberg vs
  Mutopia-derived) — 0.0105 / 0.0208 page onset error, labelled approximate,
  never claiming notehead precision.
- **E. Long multi-page**: 60-measure generated score (180 checkpoints) and
  library scores up to 150 measures (La Campanella) in the precision harness.
- **F. Valid complex polyphony**: 2 voices + chord + tuplet generated case,
  plus Spanish Romance / Turkish March / fugue BWV 846 in the library.
- **G. Malformed / incomplete**: 3 generated malformed shapes + the 13
  flagged library scores — all flagged with classification, all falling back
  to per-measure WFY, none silently repaired.
- **PDF-only holdouts** (`corranzo-holdout-intake/`, never used in
  development): Korobeiniki piano (45 measures, 605 notes, 412 checkpoints,
  valid), Chopin Fantaisie-Impromptu (51 measures, 1209 notes, 715
  checkpoints, valid), and Pachelbel Canon **guitar TAB**, which OMR rejects
  with a clear message ("No noteheads detected…") rather than inventing a
  timeline — an unsupported input is refused, not mis-followed.

Generalization audit (the "Guitar Vision hardcoded-width" class): no hardcoded
page dimensions, DPI, aspect ratios, staff sizes, measures-per-system,
engraving fonts, or score identifiers anywhere in the score-following path.
The only score names in `src/` are the dev sample-fixture registry
(`src/dev/fixturePaths.js`, used solely by `src/dev/loadSampleFixtures.js`)
and a code comment. `MAX_SYSTEMS_PER_PAGE` / `MAX_MEASURES_PER_SYSTEM` are
sanity caps with tolerant variants, not layout assumptions; geometry is
normalized (page-relative) throughout. Visual alignment is reported
separately from musical timing everywhere.

## 12. Next blocker

1. **Practice-clock render-thrash** (`Maximum update depth exceeded` during
   playback on real-PDF pairs) — pre-existing, isolated to
   `PracticeSessionContext`'s RAF tick and `useScorePlayback`'s
   `flushTimeUpdate`; needs an owner for the clock, not the follow layer.
2. **The 13 flagged library files** — still need an authoritative re-export
   (voices preserved) from their notation sources; this branch's MIDI-based
   repair path correctly refuses their performance-quantized MIDI.
3. **19 dangling tie-stops** in the flagged files — a source defect with no
   in-file evidence to pair them.
4. Reference playback duration is fixed (0.55/0.7 s) rather than the note's
   sounding duration — a fidelity gap, not a timing error.
