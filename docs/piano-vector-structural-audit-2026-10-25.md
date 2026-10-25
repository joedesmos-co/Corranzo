# Piano Vision structural candidate — independent audit (2026-10-25)

**Reviewed:** `codex/piano-truth-unblock` @ `bd143648b0` (building on
`3db0b7df18` rest reconciliation). **Decision: not integrated.** The note
counts and grand fixture improve, but the combination is not safe to promote to
practice. It retains the arithmetic rest false-acceptance and its curve
classifier labels equal-pitch slurs and cross-staff connections as ties without
the evidence the mission requires.

## Reproduction

Canonical strict scorer (raw MusicXML duration/divisions + dots + 1-based
`measure@number`; `scripts/vision-piano-reference-eval.mjs` and the research
`strict_event_score.py` agree):

| fixture | current main notes | candidate notes | current rests | candidate rests | current gate | candidate gate |
|---|---:|---:|---:|---:|---|---|
| beginner-single | 32/32 | 32/32 | 0/1 | **1/1** | false | **true** |
| rhythm-tuplets | 44/63 | 44/63 | 3/5 | **5/5** | false | false |
| grand-voices | 76/88 | **88/88** | 0/0 | 0/0 | false | **true** |
| dense-advanced | 154/264 | **185/264** | 0/0 | 0/0 | false | false |
| **total** | **306/447** | **349/447** | **3/6** | **6/6** | — | — |

The reported 349/447, grand 88/88, dense 154→185 and rest 6/6 are reproducible.
Candidate valid measures: beginner 8/8; grand 8/8; tuplets 3 invalid measures
(`2:0`, `3:0`, `6:0`); dense 4 invalid (`2:0`, `6:0`, `7:0`, `7:1`).

## Curve classifier negative controls

Synthetic IRs with whole notes so all other gate conditions pass:

| control | classifier result | gate |
|---|---|---|
| intended cross-measure equal-pitch tie | tie 1 | **true** |
| equal-pitch curved connection whose independent reference is a **slur** | tie 1 | **true — false acceptance** |
| equal-pitch curve from staff 0 to staff 1 (different voice) | tie 1 | **true — voice/staff ignored** |
| different-pitch slur | slur 1 | true (slur does not change timing) |
| curve with no nearby endpoints | ambiguous 1 | false (safe) |

The classifier uses only endpoint proximity, equal MIDI and a
non-decreasing measure. It does not check staff, voice, system, a re-attack
(repeated pitch without sustain), or independent tie/slur evidence. Equal pitch
plus a curve is not proof of a tie.

### Decorative PDF curve

Overlaying a 10×5.5 pt curved path near notes in the grand fixture produced:

- baseline: curves 2, tie 1, slur 1, gate **true**;
- with overlay: curves 3, tie 1, slur 2, gate **true**;
- note pitches unchanged, but the decorative curve was accepted as structural
  curve evidence and did not close the gate.

A 4×4 curve (articulation-sized) is routed to the augmentation-dot path rather
than the curve classifier; a 40×4 beam and a 200×1 staff line are rejected by
size. The 10×5.5 overlay is the relevant false-positive risk: any sufficiently
large decorative curve near notes can be labeled a tie/slur and still leave
practice open.

## Rest false-acceptance remains

The combined candidate still applies the `measure-fill` rest reconciliation
from `3db0b7df18`. Re-running the required controls:

| control | rest result | gate |
|---|---|---|
| intended beginner-like quarter encoded as eighth | eighth → quarter | true |
| legitimate printed eighth + one undetected note | eighth → quarter | **true — false acceptance** |
| pickup/incomplete 2.5-beat bar | eighth → half | **true — false acceptance** |
| decoded meter wrong (3/4 page read as 4/4) | eighth → quarter | **true — false acceptance** |
| two independent voices on one staff | eighth → quarter | **true — voice ignored** |
| 32nd rest underfull by more than one candidate | no change | false (safe) |

The structural commit did not add glyph-shape corroboration, voice ownership,
pickup detection or a wrong-meter guard. The old unsafe inference is still
inside the combined candidate.

## Path-drawn accidentals

The candidate adds a path branch (`paint === 22 || 23`) with a bounding box of
roughly 5–14 × 7–18 pt. It classifies any such path containing a curve as a
sharp, a horizontal-only path as natural, and a slanted path as flat. It then
attaches the path to the nearest notehead left of it within 2.5 staff gaps.

Risks visible in the code and not covered by an independent negative corpus:

- no key-signature-region exclusion (a path near the clef can be attached to
  the first playable note);
- no exclusive 1:1 ownership (the same path can be found for more than one
  notehead);
- no re-attack/articulation/decorative-path discrimination beyond the size
  window;
- path accidentals can change pitch, so this is not a display-only risk.

Our PDF overlays exercised PDF.js paint codes 20/24/25, not the candidate's
22/23 branch, so we could not independently prove a decorative path becomes an
accidental through the full PDF pipeline. That absence of evidence is itself a
reason not to promote: the branch is unverified against independent negative
examples. The existing production path-accidental detector has key-signature,
ownership and shape tests; the candidate's small branch does not.

## Multi-page extraction

`extractPianoVectorPages` on `Ao no Sumika (Piano).pdf` reproduces:

- 4 pages, notes per page **33 / 0 / 60 / 24**;
- page 2 is image/incomplete;
- 117 notes total, meter/key unknown, cross-page continuation unresolved;
- gate **false** with `incomplete-pages`, `cross-page-continuation-unresolved`,
  `time-signature-unknown`, `key-signature-unknown`,
  `measure-duration-unverifiable`.

The multi-page code is honest about page identity and incompleteness, but it
does not continue ties/slurs across pages and must not become practice-ready.

## Why no integration

The candidate is an all-in-one change: notehead/path extraction, curve
classification, rest reconciliation, gate promotion and multi-page handling.
The safe pieces are not cleanly separable in this commit, and the two new
practice-ready fixtures rely on:

1. a rest repair that still false-accepts four required controls; and
2. a tie/slur classifier that cannot distinguish an equal-pitch slur from a
   tie, or a cross-staff connection from a same-voice tie.

Current main therefore keeps **306/447 notes, 3/6 rests, beginner and grand
practice-disabled**. The candidate remains research; no production files were
changed.

## What would be needed

1. Separate notehead/path extraction from gate behavior.
2. Glyph-shape corroboration for rest repair, or no rest promotion.
3. Curve evidence from endpoints **and** staff/voice/system identity,
   re-attack, and independent tie/slur references; equal-pitch slurs must close
   the gate.
4. Path-accidental key-region exclusion, exclusive ownership and independent
   decorative/articulation/beam/staff negative controls.
5. Cross-page continuation evidence before multi-page practice.
