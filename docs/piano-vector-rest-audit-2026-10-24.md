# Piano vector rest reconciliation — independent audit (2026-10-24)

**Decision: not integrated into production.** The candidate improves the
beginner fixture but its measure-fill rule is not evidence-safe; it can promote
scores whose printed rhythm is wrong. The experimental Piano path keeps the
conservative practice gate (`practiceReady: false`) on the current main.

## Candidate reviewed

`codex/piano-truth-unblock` @ `3fc6fde749`, implementation `3db0b7df18`:

* `reports/piano_vector_core_minrest.patch`
* `scripts/pianoVectorCore_minrest.mjs`

The rule is purely arithmetic: if a measure has exactly one decoded rest,
otherwise known notes, and is short of the decoded meter, it replaces that rest
with the smallest longer rest value that makes the measure exactly full.
Provenance is `measure-fill`; no glyph-shape corroboration is used.

## Reproduced intended case

Canonical strict scorer (exact MIDI + measure + written duration + dots, 1-based
MusicXML measure numbers; the research `strict_event_score.py` rule):

| fixture | notes | rests | measures | practice |
|---|---:|---:|---:|---|
| beginner baseline | 32/32 | 0/1 | 7/8 valid | false |
| beginner candidate | 32/32 | **1/1** | **8/8 valid** | true |
| all four baseline | 306/447 | 3/6 | — | — |
| all four candidate | 306/447 | **6/6** | — | — |

The 305/447 figure from the earlier ad-hoc audit omitted the `<dots>` component
and used a different measure handling. The canonical strict scorer reports
**306/447** for both baseline and candidate. Measure numbers are taken from the
MusicXML `measure@number` (1-based), not the array index; that resolves the
one-event discrepancy. The canonical evaluator is now
`scripts/vision-piano-reference-eval.mjs` (raw MusicXML duration/divisions +
dots + measure number). It returns 306/447 and 3/6 rests on current main.

## Negative controls (candidate rule applied to synthetic IRs)

The rule is applied to the candidate function; `assessPianoVectorIr` is the
current production gate.

| control | candidate action | practice gate |
|---|---|---|
| beginner-like: quarter rest encoded as eighth | eighth → quarter; measure fills | **true** (intended) |
| legitimate printed **eighth** rest + one undetected half note | eighth → quarter; measure fills | **true** (false acceptance) |
| pickup/incomplete 2.5-beat bar with eighth rest | eighth → half; measure fills | **true** (false acceptance) |
| decoded meter wrong (3/4 while the page is 4/4) | eighth → quarter; fills decoded meter | **true** (false acceptance) |
| two independent voices on one staff, one voice short | rest upgraded; staff sum fills | **true** (voice ownership ignored) |
| one 32nd rest underfull by more than one candidate | no reconciliation | false (safe) |

A legitimate eighth rest plus a missed note is indistinguishable from the
intended “mis-encoded quarter” case using duration arithmetic alone. The
patch also sums all notes/rests on a staff, not by voice, and trusts the decoded
meter. It cannot prove the printed rest value.

## What would be required to promote it

1. Glyph-shape corroboration against the embedded font (quarter-rest vs
   eighth-rest outline), not just the codepoint.
2. Per-voice ownership, or an explicit refusal on multi-voice measures.
3. A pickup/anacrusis and wrong-meter guard.
4. An independent negative-control corpus where the printed rest is known to be
   an eighth and a note is deliberately omitted.
5. Only then allow `practiceReady` for the reconciled score.

Until those exist, the beginner fixture remains a **displayable draft with
practice disabled** on current main; the candidate rest promotion stays in
research only.
