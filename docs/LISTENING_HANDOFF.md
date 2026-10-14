# Listening handoff — Corranzo Sound Engine

**For a non-technical listener. Nothing here claims the sound is already
accepted — you are the first pair of ears, and we need your notes.**

Time needed: **about 8 minutes**. No app to install, no settings to change.
You only need a Mac.

---

## The one thing to run

Open **Terminal** (press `Cmd + Space`, type `terminal`, press Return) and
paste this whole line, then press Return:

```
bash ~/Documents/scoreflow-sound-engine/scripts/audio-render/play-examples.sh
```

It will play seven short clips one after another, printing each clip's name
before it starts. Just listen. Press `Ctrl + C` at any time to stop.

Do you want to control playback yourself instead? Every clip is a normal
audio file. Open this folder in Finder (paste into Finder's `Go → Go to
Folder…`, or `Cmd + Shift + G`):

```
~/Documents/scoreflow-sound-engine/scripts/audio-render/examples/
```

Double-click any `.wav` file to play it.

---

## What to listen for, clip by clip

| # | Clip | Ask yourself |
|---|---|---|
| 1 | **piano-melody** | Does it sound like a piano? Can you follow the four notes C–E–G–C? |
| 2 | **piano-chords** | Playing four notes at once — do they sound like *one piano*, or like four separate things stacked? |
| 3 | **piano-pp-to-ff** | The same C played five times, soft → loud. Can you hear it get louder each time? Does the very loud one stay clear instead of turning into mush? |
| 4 | **piano-top-octave** | Five high notes, G♯7 up to C8. **Do these sound in tune?** If you have any keyboard or tuning app nearby, compare the last two. |
| 5 | **electric-a3** | One clean electric-guitar note. Does it read as an electric guitar or as something else? |
| 6 | **guitar-strum** | A six-string E chord, strummed. Do the six notes sound separate, or do they mush together? |
| 7 | **acoustic-guitar-melody** | Four notes, E–G–B–E. Does each note start with a pluck and then die away naturally? |

### The specific problems we need to catch

- **Unrealistic tone** — "this is a piano, not a cheap keyboard."
- **Harsh notes** — any note that clicks, buzzes, or is gratingly bright.
- **Muffled notes** — anything that sounds duller than the notes around it.
- **Dynamic expression** — soft notes clearly quieter than loud ones
  (clip 3), and the change in *tone*, not just volume.
- **Guitar attack and decay** — a pluck at the start, then a natural fade
  (clips 5, 6, 7). Not an organ-like sustain, not an electric beep.
- **Unnatural chords** — notes in a chord arriving at slightly different
  times, or one note sounding wrong in pitch or be duller than the rest.
- **Timing problems** — anything arriving late or early, or two notes that
  should be together sounding apart.

### One thing not to worry about

These files were produced by an **offline renderer**, exactly the same
audio code the app plays. They are a stand-in for listening in the product.
You are judging the *sound*, not the product's buttons.

---

## If you want to compare against the previous version (optional)

This takes about two extra minutes. It lets you hear what changed.

```
cd ~/Documents/scoreflow-sound-engine
node scripts/audio-render/export-examples.mjs          # current version
rm -rf /tmp/sound-after && cp -r scripts/audio-render/examples /tmp/sound-after

git checkout 920cf44874 -- .                            # previous version
node scripts/audio-render/export-examples.mjs
rm -rf /tmp/sound-before && cp -r scripts/audio-render/examples /tmp/sound-before

git checkout HEAD -- .                                  # back to current
open /tmp/sound-before /tmp/sound-after
```

Two Finder windows open with matching filenames. Play `electric-a3.wav`
from each — the electric guitar is a different, properly licensed sample
set now. Then play `listening-piano-pp-to-ff.wav` from each — the soft-to-
loud steps are wider apart now.

(If the commands look risky: they only touch this folder and `/tmp`, and
the last line restores everything.)

---

## How to report back

For anything that sounds wrong, the most useful note is:

> "clip 3, about four seconds in — the loud note sounds crunchy"

or

> "clip 7, the third note sounds duller than the others."

Rough is fine. Approximate positions are fine. We can measure and find it
from there.

**Nothing in this handoff has been listened to yet, and no acceptance has
been claimed for any of it.**
