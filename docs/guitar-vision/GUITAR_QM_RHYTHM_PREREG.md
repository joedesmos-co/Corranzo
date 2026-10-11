# Prereg: Qmek isolated-beam rhythm (Mission 1, no training)

**Problem:** pair-bridges need an adjacent beamed onset; Qmek's 8ths
sit in isolated single-note groups -> pb=0 -> defaulted durations.
Txo is solved (95% pairs) but that texture isn't Qmek's.

**Frozen design (three additive cues, all image-only, fired only when
pair-bridges give 0):**
1. **Flag detection**: at the detected note box's stem side, a small
   solid component (area 30-400px, at tip-side, y within 90px of the
   notehead) = flagged-8th (unless stems run into a beam).
2. **Beam-single**: a beam object (staff-excluded (1,20)-opened ink
   component, w>=25, h<=10) whose x-range overlaps the note x +-12px
   and whose y is within the rhythm zone [mindy-140, mindy-40] of the
   note's system.
3. **Stem-present fallback**: stem found (anchored_stem) and no flag
   and no beam -> quarter (existing rule).

Flags taken as strongest evidence, then beams, then stems.

**Frozen splits:** TRAIN-fit selects (Qmek duration exact rate +
Txo must not drop); TRAIN-heldout verifies ONCE (Txo + Qmek FULL);
DEV window on bravura (no change expected; final wave if time).

**Baselines (frozen):** Qmek dur 50/496 (10%); Txo dur 339/349
(97.7%), FULL 93.4%.

**Acceptance:** Qmek duration exact rate +>=20pts absolute AND Txo
duration unchanged (within 2 notes). Else REVERT the cue set.

**Constraints:** no training; no GT boxes in inference; no TEST.


**Verdict: REJECTED (source-truth dependency found, then confirmed).**
Census (534 Qmek TAB events): duration classes are 8ths (532, beamed
PAIRS), dotted quarters/halves (386+70, voice 2), quarters (14).
Tried and measured:
- flag cue: anchored flags NEVER fire (0/534) — Qt renders 8ths with
  beams only; flags don't exist at digit-x.
- beam-object overlap: constant (always True) — no discrimination.
- right-blob dots: 41/72 on page 1 only; staff-line pollution.
- dash-after-digit: inverted (dots have FEWER right segments).
- voice separation by y: voices are y-interleaved (9 transitions),
  so dotted (voice-2) and plain (voice-1) onsets are SPATIALLY
  INDISTINGUISHABLE. Dotted-ness is a cross-part source relation
  (voice-2 pairing), not an ink feature.
Conclusion: Qmek dotted durations are not recoverable from the TAB
image alone with current primitives. The correct next primitive is
NOTATION-side (voice-2 noteheads + dots in the standard staff), which
requires note-to-TAB association — out of scope for this window.
Honest state: Qmek durations stay ~10% (8ths recoverable in principle
via pair-bridges once beamed-pair grouping separates; dotted NOT).


**Addendum (geometry blocker measured):** Qmek TAB digit x-gaps are
p50=5px, p75=13px, max=52px — BEAMS span pairs within those gaps, so
the 8-100px pair window that solved Txo structurally cannot apply.
8th-ness would need stem-tip or beam-overlap detection at the digit's
own x (not pair bridges); stem-tip counting was measured earlier and
is indiscriminate on this engraver (single beams read 1-3).
