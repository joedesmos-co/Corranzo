# Corranzo — Native Notehead Feedback: Implementation & Release Report

## 1. Root cause of the floating markers

The user's screenshot showed several **green outlined circles with a centre dot
floating above the engraved notes**, plus a blue marker. They came from the
score-follow overlay's **geometry marker**:

- `src/components/pdf/ScoreFollowOverlay.jsx` rendered
  `.score-follow-overlay__note-target` containing
  `.score-follow-overlay__note-target-ring` (a **44 px circle**, 20 px in the
  compact variant) and `.score-follow-overlay__note-target-dot`, positioned at
  the note's x/y with a **negative offset** (`left: -22px; top: -22px`) so the
  ring hovered *over* the staff instead of *on* the note.
- A second layer, `ScoreNoteStateHighlight`, drew **rectangular boxes**
  (`.score-follow-overlay__note-highlight`) around noteheads, coloured blue for
  the required note, green for a played one and red for an error.

Both are geometry/debug affordances rendered as if they were the practice
feedback. The ring was also drawn in a colour that changed with the state, so
it read as a green "target" floating in the margin.

**The note-to-geometry mapping underneath is unchanged** — it still drives the
notehead positions. Only the presentation changed.

## 2. Notehead-colour implementation

- **`src/features/practice/noteheadFeedback.js`** *(new, pure)* — the palette,
  the engraved shape of a notehead, and the mapping from a practice event to
  the noteheads it owns.
- **`src/components/pdf/NoteheadFeedbackLayer.jsx`** *(new)* — renders each
  owned notehead as an SVG shape in the notehead's own place on the staff.
- **`src/features/practice/noteTargetPosition.js`** — the note target now also
  exposes the **per-note placements it already computed** (`notePlacements`,
  one per note, each carrying the printed notehead's own extent when the score
  owns it) and the **notehead size derived from the staff**.
- **`src/components/pdf/ScoreFollowOverlay.jsx`** — the box layer and the
  floating marker are replaced by the notehead layer. The floating marker is
  kept **only behind the explicit `?debugNoteMarkers=1` flag**.
- **`src/features/practice/osmdEngraving.js` / `OsmdScoreView.jsx`** — the
  MusicXML-only surface (Audio Vision arrangements) paints the same colours on
  its **real OSMD noteheads** and no longer highlights anything in Preview.
- **`src/context/PracticeSessionContext.jsx`** — Preview no longer paints a
  note target.

Colours, chosen for contrast on the white score paper:

| meaning | colour |
|---|---|
| played correctly | blue `#1d4ed8` |
| completed with help | yellow `#a16207` |
| missed expected note | red `#b91c1c` |
| wrong attempt (on the required note) | red `#b91c1c` |
| still expected (soft focus ring only) | blue ring at 38% |

## 3. Mode-specific behaviour

| | Preview | Wait For You | Play Along |
|---|---|---|---|
| red playback cursor | moves | locks to the required note | moves |
| notehead colour | **none** (black engraving only) | blue when played, red on a wrong attempt, focus ring on the required note | blue when played, red when missed |
| floating circles | **none** | **none** | **none** |
| boxes | **none** | **none** | **none** |
| waits for the musician | no | **yes** | no (playback continues) |

## 4. Chord and repeated-note correctness
- A chord's members are painted **individually** as they are recognised
  (`toneStates` drive a per-member colour), including when only part of the
  chord is done.
- Simultaneous notes keep their own notehead: the placements are per note, and
  the painted shape is that note's own (filled / half / whole).
- Repeated notes are separate events with separate placements, so each lights
  on its own onset.
- A wrong note never lights a correct notehead (blue count is unchanged) and
  never advances the requirement — the music waits.
- The existing engine produced every state; **no recognition threshold, musical
  timing or score-following behaviour was changed**.

## 5. Geometry without hardcoded positions
- When the score owns the printed notehead (OMR source geometry, e.g. an
  imported PDF), the feedback is drawn on **that head's own extent** — exact.
- When the score carries no engraved layout (e.g. the bundled demo edition,
  whose MusicXML has no `default-x`/`default-y`), the head is **sized from the
  staff** and **placed by pitch**, so a low note sits low and a high note sits
  high instead of every note landing on one line.
- Nothing is hardcoded for any piece.

## 6. Browser evidence
`scripts/audit/notehead-feedback-probe.mjs` drives the real app (real MIDI
injection, real audio) and captures screenshots of all three modes into
`tmp/notehead/`.

- **Chromium: 15/15 checks pass.** Including: Preview has the red cursor and
  zero floating markers / zero notehead feedback / zero boxes; a wrong WFY note
  lights nothing and does not advance; the correct chord lights its own
  noteheads blue and advances the requirement; Play Along shows a red notehead
  for a missed expected note.
- **WebKit (Safari engine): 12/12 applicable checks pass.** WebKit has **no
  Web MIDI**, so the MIDI-only checks are reported as *untestable there* — not
  as passed. The focus treatment, the absence of floating markers and the
  clean Preview are all verified there.
- **Live site (`https://corranzo.com`, production build): all applicable
  checks pass.** The MIDI injection hook is a development affordance compiled
  out of a production build, so "the correct note advances" is reported as
  untestable on the live site, honestly.
- Screenshots: `preview-{chromium,webkit}.png`, `wfy-correct-chromium.png`,
  `wfy-wrong-chromium.png`, `play-along-{chromium,webkit}.png`.

## 7. Regression results
- **Unit: 3866 passed, 19 skipped, 0 failed** (EXIT=0).
  New: `tests/noteheadFeedback.test.js` (7 tests).
  Updated: `tests/scoreOverlayNoteStates.test.js` (the state contract is now
  "the state is on the notehead", not "a box with a state class").
- **Browser e2e: 136/136** — score-follow 17, unified-practice-midi 25
  (the previously flaky one), practice-reliability 18, pdf-first-import 17,
  product-audio 12, mobile-reliability 12, audio-vision-edge 12,
  unified-practice-mic 23.
- No console or page errors in any run.
- Unchanged and re-verified: the red cursor's precision, Audio Vision worker
  fix, persistence, PDF-first import, guitar TAB, score-following timing.

## 8. Deployed commit and Cloudflare version
- **Commit:** `abe7f85f23` on `bugfix/site-bug-hunt`, fast-forwarded onto
  official `main` (`abe7f85f23`). The release also carries the Practice
  Engine's unified Audio Vision practice engine, which landed on `main` while
  this work was in flight and was merged in (no conflicts).
- **Cloudflare version ID: `9ba0a942-8394-4fa3-9ba5-c04fb747f979`**
- **Live bundle:** `index-WAVIfkxz.js` (byte-identical to the local build);
  `/`, `/privacy`, `/terms`, `/contact` all return HTTP 200.
- The live site was re-verified after deployment: Preview is clean, the
  floating markers are gone, the notehead feedback is present, and Play Along
  shows a red notehead for a missed note. The Audio Vision critical-UX suite
  passes **19/19 against the live site in WebKit** (including the guitar
  six-line TAB staff and the arrangement surviving a browser restart).

## 9. Rollback
- Previous live version ID: `50b609d4-2834-485f-86c5-8fce88fe6eb4` (bundle
  `index-Czbeq01m.js`, the release before the notehead feedback).
- `npx wrangler rollback 50b609d4-2834-485f-86c5-8fce88fe6eb4`
- Git: `git revert d12bdd653b` (the notehead feedback commit) on
  `bugfix/site-bug-hunt` / `main`, then rebuild and redeploy.

## 10. Remaining limitations
- For a score whose MusicXML carries no engraved layout, the notehead position
  is an approximation (staff-sized, pitch-placed) rather than the printed
  head. The exact printed head is used whenever the score owns it.
- The focus ring is a soft halo around the required notehead; there is no
  separate "play now" arrow, because the user asked for no floating markers.
- MIDI-driven WFY verification is only possible in a development build (the
  injection hook is compiled out of production). Physical microphone
  acceptance was **not** claimed — no hardware was used.
- A wrong attempt flashes the **required** notehead red. It never lights a
  correct note and never advances the score.
