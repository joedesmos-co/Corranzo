# Piano Vision safety repair — independent audit (2026-10-25, round 4)

**Candidate:** `723b47847c` on `codex/piano-truth-unblock`, on top of
`bd143648b0` and `3db0b7df18`.
**Decision: no production port.** The rest-inference promotion is fixed, but
the candidate still promotes scores whose curve/voice evidence is unsafe.

## Reproduced accuracy

Canonical strict scorer (raw MusicXML, written duration + dots + 1-based
`measure@number`):

| fixture | current main | `723b…` | candidate gate |
|---|---:|---:|---|
| beginner | 32/32 | 32/32 | **false** (`rest-duration-inferred`, `rest-duration-ambiguous`) |
| rhythm/tuplets | 44/63 | 44/63 | false |
| grand/voices | 76/88 | **88/88** | **true** |
| dense | 154/264 | **185/264** | false |
| **total** | **306/447** | **349/447** | — |

Rests total **6/6** on the candidate; beginner is now 1/1 visually inferred but
refused. Grand MusicXML contains 88 notes, 12 `<alter>` accidentals, one tie
(`<tie>` + `<tied>` start/stop) and one slur start/stop. Those claims reproduce.

## Rest safety repair

`723b` adds:

- `restInferred` / `rest-duration-inferred`;
- `rest-duration-ambiguous` when `visualEvidence` is
  `ambiguous-glyph-shape`;
- `unresolved-accidentals` for a music-sized filled symbol that cannot be
  classified;
- a long/high curve guard (`c.h > 2.5*gap` or endpoint distance `> 10*gap`).

Independent rest controls now all remain blocked:

| control | reconciliation | gate |
|---|---|---|
| intended mis-encoded quarter | inferred | false |
| legitimate eighth + undetected note | inferred | false |
| pickup/incomplete bar | inferred | false |
| wrong decoded meter | no inference / invalid | false |
| two independent voices with a rest | inferred | false |
| 32nd rest underfull by more than one candidate | no change | false |

This closes the arithmetic rest promotion. It does **not** make the candidate
safe overall.

## Remaining false acceptances

Using synthetic IRs on the `723b` module:

| control | classifier result | gate |
|---|---|---|
| equal-pitch short curve whose reference is a **slur** | **tie** | **true — false acceptance** |
| same-staff two voices each 2 beats (sum 4) | no voice check | **true — each voice incomplete** |
| decorative short curve between different pitches | **slur** | **true — decorative path accepted** |
| long/high same-pitch curve | ambiguous | false (new guard works) |
| curve with no nearby endpoints | ambiguous | false |
| unresolved accidental | — | false (new guard works) |

The curve guard only rejects very long/high curves. It still has no staff,
voice, system, re-attack or independent slur/tie evidence. The gate sums notes
by `measure:staff`, not by voice, so two incomplete voices can fill a staff and
open practice. The decorative short curve is accepted as a slur and leaves
practice open.

## Path accidentals

`723b` adds an unresolved-accidental diagnostic, but accepted path paths still
use a small bounding-box heuristic with no key-signature-region exclusion or
exclusive ownership. A path classified as a sharp/flat/natural is applied to
note pitch. We could not independently drive the paint-22/23 branch with
PDF.js overlays; that is absence of safety evidence, not proof of safety. The
existing `grand 88/88` result depends on path-drawn accidentals, so extraction
cannot be separated from this risk by accepting the fixture number alone.

## Multi-page

`Ao no Sumika (Piano).pdf` reproduces 4 pages with **33 / 0 / 60 / 24** notes;
page 2 is image/incomplete; 117 notes; cross-page continuation unresolved; gate
**false** with `incomplete-pages`, `cross-page-continuation-unresolved`,
`time-signature-unknown`, `key-signature-unknown`,
`measure-duration-unverifiable`.

## Component judgement

| component | result |
|---|---|
| A. extraction-only note/path changes | rejected: grand/dense gains depend on unverified path accidentals |
| B. accidental detection | rejected: no independent key-region/ownership/decorative-path evidence |
| C. curve classification + serialization | rejected: equal-pitch slurs and decorative curves still promote |
| D. multi-page | not accepted for practice; honest extraction only, but not needed for this round |
| E. practice gate/uncertainty | rest fix is correct, but remaining gate false acceptances block promotion |

No production Piano files changed. Current main remains **306/447 notes, 3/6
rests**, with beginner and grand practice-disabled.
