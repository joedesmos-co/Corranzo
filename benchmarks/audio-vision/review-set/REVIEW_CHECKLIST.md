# Audio Vision — listening review checklist (1–5 + free-form)

Identical checklist for every generated score. 3–5 minutes per example.
Answer **1 = strongly disagree, 3 = neutral, 5 = strongly agree**. The most
important two are **Recognition** and **Main instrument playable** — answer
those before the rest.

| # | Question | Score (1–5) |
|---|---|---|
| 1 | **Recognition.** I can tell what the original piece is from this arrangement alone. |   |
| 2 | **Melody.** The main melody is audible and recognizable across the arrangement. |   |
| 3 | **Harmony.** The chord changes and bass line sound like the original, not a different piece. |   |
| 4 | **Rhythm.** The pulse, duration and rest pattern sound basically right. |   |
| 5 | **Main-instrument playable (guitar).** One guitarist can play the TAB + standard score as written. |   |
| 6 | **Main-instrument playable (piano).** Both hands can play without impossible spans or fingerings. |   |
| 7 | **Difficulty.** Easy is genuinely easier than Intermediate, which is easier than Advanced. |   |
| 8 | **Overall usefulness.** I would actually practice from this score. |   |

## Free-form notes (please fill even just one line each)

- Anything that sounded **wrong** (melody note, chord, timing, a jump):
- Anything that was **unplayable** (impossible stretch, unattainable chord, illegal TAB position):
- Anything that was **missing** (a phrase that should have been kept, a section that vanished):
- Whether you would call any of these recordings **unusable** (refusal rather than a bad score would have been better):

## Files per example (use VERSION=ALONGSIDE as the paired preview)

For each example, the directory `benchmarks/audio-vision/review-set/` contains:
- `mozart-trio-mix--solo-{piano,guitar}--{easy,intermediate,advanced}.musicxml`
- the matching `.mid` (verified to agree with the score)
- `guitarset-comping--solo-{piano,guitar}--…`
- `mozart-trio-mix`, `guitarset-comping`, `five-piece-mix`

## The three examples to prioritise

1. **`mozart-trio-mix`** — chamber trio, strongest scores. If this sounds wrong, the pipeline is fundamentally off.
2. **`guitarset-comping`** — guitar comping, clearest chord-classification test.
3. **`five-piece-mix`** — vocals + guitar + bass + drums + piano, and our own uncertainty check *already distrusts it* (agreement 0.39, 8 uncertain windows). Listen to see if the distrust is right.

A score of **≥ 4 on Q1 and Q5/Q6 on Basic score × 2 reviewees** is what gates V1. A 1 or 2 on Q1 or Q5/Q6 is a hard failure and should be reported by filename.

## Listening mechanics

- **On macOS:** double-click `.mid` → plays in GarageBand (verified), or opens in Logic, QuickTime... no — QuickTime does **not** open `.mid`. MuseScore opens `.musicxml` (+ TAB for guitar parts). VLC also plays `.mid`.
- **Source recordings** live outside the repo: `/tmp/trios/TRIOS Dataset/…`, `/tmp/guitarset/00_*_mic.wav`, `/tmp/realcorpus/…`. Re-materialise them with `node scripts/audio-vision-fetch-corpus.mjs`.
- **If a file is missing**, the directory is regenerated from the current code with `node scripts/audio-vision-review-set.mjs` (no audio is bundled, so licenses ride with every item).
