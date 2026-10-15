# Audio Vision — listening handoff (3 examples)

**What this is.** Nine generated arrangements (3 recordings × piano + guitar ×
3 difficulties) plus playable preview audio, ready for a musician to listen to
on this Mac. Nothing here has been listened to yet — that is exactly what this
handoff is for.

**The one thing to remember:** confidence and agreement numbers in the manifests
are machine evidence about pitch, timing and chord labels. They are **not** a
claim that these scores sound good. Only a listener can say that.

---

## How to listen (about 15 minutes)

1. Open the **original recording** in QuickTime Player (or VLC) so you know the piece.
2. Play the matching **`.mid` preview**. Verified route on this Mac: **GarageBand**
   (double-click the `.mid`, or drag it onto an empty GarageBand window) renders
   and plays the file as-is. MuseScore, Dorico, Finale and VLC also play `.mid`.
   *QuickTime Player does not open `.mid` files* — checked, so do not use it for
   the preview. It is the same music as the score.
3. Open the **`.musicxml`** in MuseScore, Dorico or Finale if you want the notation
   and TAB.
4. Answer the three questions in the checklist below.

Both preview and score come from the identical note list, so what you hear in the
preview is what is notated in the score (verified programmatically for all 36
pairs).

---

## Example 1 — strong / simple: `mozart-trio-mix`

**Why this one:** a 3-instrument chamber recording; it is where our machine
checks are strongest (melody recall 0.84 piano / 0.87 guitar at Advanced;
bass retention 0.85 / 0.87; only 1.8% invented notes). If this does **not**
sound right, the problem is fundamental.

| | Path |
|---|---|
| Original recording | `/tmp/trios/TRIOS Dataset/mozart/mix.wav` (33 s, clarinet + piano + viola, CC BY-NC-SA 2.0 UK, local eval only) |
| Piano score (Advanced) | `benchmarks/audio-vision/review-set/mozart-trio-mix--solo-piano--advanced.musicxml` |
| Piano preview (Advanced) | `benchmarks/audio-vision/review-set/mozart-trio-mix--solo-piano--advanced.mid` |
| Guitar score (Advanced) | `benchmarks/audio-vision/review-set/mozart-trio-mix--solo-guitar--advanced.musicxml` |
| Guitar preview (Advanced) | `benchmarks/audio-vision/review-set/mozart-trio-mix--solo-guitar--advanced.mid` |
| Easy / Intermediate variants | same folder, `--easy` / `--intermediate` before `.musicxml` / `.mid` |

**Listen for:** (1) can you name the melody? (2) does the left hand or the
guitar accompaniment land on sensible harmonies? (3) is the tempo right?

---

## Example 2 — moderate: `guitarset-comping`

**Why this one:** a real guitarist comping chords at 86 BPM. This is the
recording where our chord **labels** are best (bar-aligned root 0.688,
quality 0.688) and where 0 windows were flagged uncertain.

| | Path |
|---|---|
| Original recording | `/tmp/guitarset/00_SS3-84-Bb_comp_mic.wav` (46 s, CC-BY-4.0, Xi et al. ISMIR 2018) |
| Piano score (Advanced) | `benchmarks/audio-vision/review-set/guitarset-comping--solo-piano--advanced.musicxml` |
| Piano preview (Advanced) | `benchmarks/audio-vision/review-set/guitarset-comping--solo-piano--advanced.mid` |
| Guitar score (Advanced) | `benchmarks/audio-vision/review-set/guitarset-comping--solo-guitar--advanced.musicxml` |
| Guitar preview (Advanced) | `benchmarks/audio-vision/review-set/guitarset-comping--solo-guitar--advanced.mid` |

**Listen for:** (1) do the chord changes happen at the right moments (this is the
clearest test of the harmony work)? (2) can one guitarist actually play the
guitar version — reasonable positions, no impossible stretches? (3) does the
piano left hand move sensibly?

---

## Example 3 — difficult multi-instrument: `five-piece-mix`

**Why this one:** vocals + guitar + bass + drums + piano. Our own uncertainty
check already distrusts this one (agreement 0.39, **8 of 23 windows flagged
uncertain**, melody recall 0.61).

| | Path |
|---|---|
| Original recording | `/tmp/realcorpus/bag-of-motifs-excerpt.wav` (20–65 s excerpt, CC BY-NC, local eval only — **do not redistribute**) |
| Piano score (Advanced) | `benchmarks/audio-vision/review-set/five-piece-mix--solo-piano--advanced.musicxml` |
| Piano preview (Advanced) | `benchmarks/audio-vision/review-set/five-piece-mix--solo-piano--advanced.mid` |
| Guitar score (Advanced) | `benchmarks/audio-vision/review-set/five-piece-mix--solo-guitar--advanced.musicxml` |
| Guitar preview (Advanced) | `benchmarks/audio-vision/review-set/five-piece-mix--solo-guitar--advanced.mid` |

**Listen for:** (1) does the vocal melody survive? (2) is the harmony anywhere
close, or is it a different piece? (3) if it is bad, is the failure "unusable"
(should be refused) or "rough but salvageable" (should ship with a warning)?

---

## Checklist (score each 1–5)

1. **Recognition** — can you tell what the piece is from the melody alone?
2. **Harmony** — do the accompaniment and chord changes sound like the original?
3. **Playability (guitar)** — can one guitarist play it?
4. **Playability (piano)** — can two hands play it?
5. **Tempo/rhythm** — is the pulse right, or half/double?

Write the answers next to the file names in
`benchmarks/audio-vision/review-set/manifest.json` (each variant already records
its license, tempo, note count, confidence, agreement and uncertain-window count).

## If a file does not exist

The TRIOS and GuitarSet corpora are local-only and may have been cleaned from
`/tmp`. Regenerate everything with:

```sh
node scripts/audio-vision-fetch-corpus.mjs      # re-materialize corpus audio
node scripts/audio-vision-review-set.mjs        # rebuild scores + previews
```

The review set is regenerated from the current code, so re-run it after any code
change before asking a musician to listen.

## Licensing

Original recordings are **not** bundled here and must not be redistributed.
Licences per item are in `benchmarks/audio-vision/review-set/manifest.json`
(TRIOS CC BY-NC-SA 2.0 UK, GuitarSet CC-BY-4.0, ccMixter CC BY-NC — all local
evaluation only).
