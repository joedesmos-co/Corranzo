# Three recommended listening examples

These three are the most informative for a musician to review: one strong,
one moderate, one difficult. Everything you need is in this directory; the
audio references stay outside the repo (paths + licenses in `manifest.json`).

Listen in this order. If our numbers are lying, these are the files that show it.

---

## 1. Strong / simple — `mozart-trio-mix--solo-{piano,guitar}--advanced`

- **Source:** TRIOS mix (clarinet + piano + viola), 33 s, 117 BPM.
- **License:** CC BY-NC-SA 2.0 UK (local evaluation only).
- **Corpus audio:** `benchmarks/mic-real` labeling shows the same performance
  family; see `manifest.json` → `audioPath` for the exact file.
- **What our checks say:** melody retention 0.90/0.90 (piano/guitar), bass root
  retention 0.85/0.87, invented notes 1.8%, chord windows 61.
- **Listen for:** whether the melody reads as the tune, and whether the
  accompaniment lands on the right beats.

## 2. Moderate — `guitarset-comping--solo-{piano,guitar}--advanced`

- **Source:** GuitarSet singer-songwriter comping performance, 46 s, 86 BPM.
- **License:** CC-BY-4.0 (Xi et al., ISMIR 2018).
- **Corpus audio:** `/tmp/guitarset/tracks/00_SS3-84-Bb_comp_mic.wav`.
- **What our checks say:** melody recall 0.88, chord root 0.81, uncertain
  windows 0, dense strumming preserved.
- **Listen for:** whether chord changes happen at the right moments, and
  whether the guitar version can actually be played (strums vs arpeggios).

## 3. Difficult — `five-piece-mix--solo-{piano,guitar}--advanced`

- **Source:** ccMixter "A Bag Of Motifs" (Radioontheshelf feat. Spinningmerkaba),
  excerpt 20–65 s, vocals + guitar + bass + drums + piano. 200 BPM.
- **License:** CC BY-NC — local evaluation only, **never a commercial asset**.
- **Corpus audio:** `/tmp/realcorpus/bag-of-motifs-excerpt.wav`.
- **What our checks say:** this is our weakest and most honest case —
  agreement 0.39, **8 of 23 windows flagged uncertain**, melody recall 0.61,
  bass 0.55. Our own uncertainty check is already telling you to distrust it.
- **Listen for:** what breaks first — the melody, the feel, or the harmony.
  If it is unusable, the correct product response is a partial arrangement or
  a refusal, not a confident score.

---

## What to compare against

- **Original source reference:** the `audioPath` file per item in `manifest.json`.
- **Generated arrangement:** the `.musicxml` files here (easy/intermediate/
  advanced, solo piano and solo guitar).
- **Known uncertainty:** `agree` (how often a second, model-free transcriber
  heard the same pitches) and `uncertainRegions` (2-second passages where the
  two methods disagreed) are recorded per variant.

## What to write back

Per file, a number 1–5 for recognition, playability (guitar or piano), and
harmony — plus anything that sounded wrong. The three examples above are
enough to tell us whether the pipeline's promise holds for real songs.
