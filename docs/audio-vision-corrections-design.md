# Audio Vision — full note-correction model: design proposal

The shipped correction is remove + undo-all, keyed by `pitch@time` and stored
separately from the transcription and the arrangement
(`docs/audio-vision-note-corrections.md`). This is the design for completing it
without disturbing that architecture. **Proposal only** — no code in this
research branch.

## What changes, and what must not

The current three layers stay exactly as they are:

```
transcription   immutable, the model's evidence
corrections     a versioned record of what the musician changed
arrangement     derived from both, always rebuilt, never edited in place
```

Completion adds four *operations* to the record. Nothing about the pipeline
changes: a correction set still goes in, the score still comes out.

## The record

```js
{ version: 2,
  notes: {
    "64@1.50#1": { removed: true },                       // shipped today
    "72@2.00#1": { pitch: 71 },                           // -1 semitone
    "67@4.25#1": { onsetSeconds: 4.30 },                  // nudged later
    "60@0.00#1": { durationSeconds: 1.5 },                // lengthened
  },
  added: [ { id: "user-1", midi: 67, onsetSeconds: 3.0, durationSeconds: 0.5, hand: "RH" } ],
}
```

* Keys are still content keys (`pitch@time#occurrence`), so a regeneration
  keeps them and a stale entry is inert.
* `pitch` and `onsetSeconds` are **deltas from the machine's value**, not
  absolutes. If the model changes and the note moves slightly, the correction
  still means "a semitone lower", not "force this exact pitch".
* `added` entries are new notes with their own ids; they are never confused
  with the model's notes and never "re-detected".

## Applying it

```
transcription --remove--> --retune--> --nudge--> --lengthen--> + added --> arrangement --> MusicXML
```

Order matters and is fixed: removals first (so a retune can never resurrect a
removed note), then pitch, then onset, then duration, then additions. Each
stage is a pure function over `{ events, corrections }`, testable in isolation.

## Invariants the tests must hold

1. **No unrelated note changes.** Every operation is keyed; a golden test
   compares the full note list before/after with a single correction applied.
2. **Removals win over every other edit.** A retuned-and-removed note is gone.
3. **Additions never collide.** An added note landing on an existing
   (pitch, time) is offset in the record, not silently merged.
4. **Rebuild is deterministic.** The same record applied twice yields byte
   identical MusicXML.
5. **Practice targets follow.** The checkpoints are rebuilt from the corrected
   events, so a removed note stops being a target and an added note becomes one
   (already true for removals — see `useAudioArrangement`).
6. **Persistence is versioned.** `v1` records (removals only) load unchanged;
   `v2` is additive.

## UI, minimum viable

One editable list (the shipped "Review notes"), each row gaining: a pitch
stepper (±1 / ±12), an onset nudge (±1 subdivision), a duration stepper, and a
delete. "Add note" inserts at the playhead with the current hand. A single
"Undo last edit" button (the record keeps an operation log; `undoLastRemoval`
already exists).

## Scope and risks

* **Estimated work**: ~1.5 days — the record and the five pure functions with
  tests (~0.5 d), the pipeline wiring (~0.25 d), the UI (~0.75 d). No model,
  worker or engraving change.
* **Main risk**: retuning across a chord boundary (a note becomes the same
  pitch as a neighbour at the same onset). Handled by the collision invariant
  and the existing `resolveSimultaneous` pass, which runs after corrections.
* **Do not** build a full score editor on top of this: the arrangement is
  regenerated, not hand-edited, and the Practice Engine expects a generated
  score. Corrections stay at the note-list level.

## Why this is the right shape

Every failed experiment on this branch tried to make the model's evidence say
more than it does. The correction record is the opposite: it lets the musician
supply the evidence the model lacks, once, in a form the pipeline can re-apply
deterministically. It is also the honest answer to the 35 % of notes the model
cannot hear at all.
