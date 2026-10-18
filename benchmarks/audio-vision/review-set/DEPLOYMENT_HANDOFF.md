# Audio Vision — deployment handoff

**For the Score Following deployment owner.** The "possible TAB regression" reported is
not a TAB regression. TAB is intact on both branches (100% of pitched notes carry
`<technical><string>/<fret>`; verified on three independent recordings and on
the staging branch itself). What staging has is the **pre-fix MusicXML emitter**:
it was cut (`031e4f8cfa`) on 2026-10-10, six days before my MusicXML fix landed,
and its emitter still writes chord notes with their own durations — which makes
measures read as overfull (64 + 16 + … past the barline) and shifts the
notation/TAB timeline. That is what looks like a TAB regression to a renderer.

## What to cherry-pick (single commit, ~400 lines)

`c9e5e9b23d` (`docs(audio-vision): release-readiness checklists, M1 semantic
validation suite`) depends on `9648f75220`. The minimal focused commit is:

```
9648f75220 fix(audio-vision): three real MusicXML-emission defects; semantic validation
```

It touches only `src/features/audio-vision/arrangementMusicXml.js` and adds
`tests/audioVisionMeasureIntegrity.test.js` (3 cases). It does NOT change the
arrangement pipeline, the parser, the practice engine, or the TAB encoding — it
only fixes how the emitter lays out durations and chord groups.

**Verified effect on staging's own test fixture (guitarset comping, 46 s):**
- before: 8 overfull voices (RH voice total 128 in a 64-division bar)
- after: 0 overfull voices, 0 notes past barline, 0 invalid chord durations

## What the fix changes

1. **Chord notes reuse the parent onset's duration** — a `<chord/>` note with its
   own duration is invalid MusicXML. The emitter now copies the parent's
   divisions.
2. **Chord members no longer clip each other** — a 0.25-beat chord member was
   being clipped to a 1/16 division.
3. **`<backup>` is always emitted before the LH voice** — even when the LH is
   empty, so the parser resets the cursor instead of continuing the RH timeline
   into the LH rest (64 + 64 = 128).
4. Each staff's voice is written to exactly `beats × divisions` by construction,
   with a trailing rest absorbing any remainder.

## Verification (run on my branch)

- `tests/audioVisionMeasureIntegrity.test.js` — 3 cases, all green.
- `scripts/audio-vision-measure-audit.mjs` — 20 configs × 2 parts → 0 overfull
  voices, 0 notes past barline, 0 invalid chord durations.
- `scripts/audio-vision-preview-verify.mjs` — 36/36 score↔preview agreement.
- `scripts/audio-vision-practice-verify.mjs` — 10/10, including
  "notes respect barlines (ties) — 0 violations".
- `npm run build`, `npm run test:scripts` exit 0, browser UI flow 7/7.

## What NOT to cherry-pick

- `scripts/audio-vision-review-set.mjs` regenerations (they rewrite 72 files).
- The `src/features/audio-vision/tempoCorrectionStorage.js` work — that is
  independent and can ship separately.
- Any of the timing-experiment commits — they are explicitly rejected and
  documented; the latest research commit `3cabda612f` contains the rejected
  evidence in case it is useful for the deployment owner's own investigation.

## If the deployment owner wants the full set

The complete Audio Vision pipeline on my branch is at `a42068a716` (with the
later commits `9648f75220` and `c9e5e9b23d` on top). The shared preview
(`scoreflow-product-preview`) is NOT touched by this work — the deployment
agent keeps integration ownership there.

## What I need from the deployment owner

1. Confirmation of whether the overfull-measure symptom matches what they saw.
2. Whether the staging branch should be rebased onto my emitter fix, or whether
   they want a patch file (`git format-patch 9648f75220^..9648f75220`).
3. The real-device WFY run on an arrangement, which I cannot do from here.
EOF
echo written; wc -l benchmarks/audio-vision/review-set/DEPLOYMENT_HANDOFF.md