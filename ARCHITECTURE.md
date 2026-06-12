# ScoreFlow Architecture

ScoreFlow is a practice-focused web app: PDF score + MusicXML timing, optional MIDI backing, cursor follow, loops, and Wait For You input.

## Timeline API (`src/features/musicxml/timeline.js`)

The **performed timeline** is the single time domain for playback, loops, Wait For You, and cursor lookup.

- `getTimeline(timingMap)` returns a facade with:
  - `performedDurationSeconds`
  - `performedBeats()` — beat times with `repeatPass`
  - `performedNotes()` — note onsets on performed time
  - `locate(t)` — measure/beat at performed instant
  - `windowsForMeasure(n)` — all performed windows for a written measure (handles repeats)
- Written-time fields on `timingMap.measures` remain for navigation labels; consumers that need repeat-aware behavior must use the timeline API.

## Playback engine (`src/features/playback/`)

- **`ScorePlaybackEngine`** — windowed scheduler on performed score time; deduped event keys; `releaseAll()` on stop/seek/loop wrap.
- **Sources:** MusicXML notes synthesized via Tone.js; optional MIDI mapped onto performed time via `midiToPerformedMapping.js` (measure-aligned when confident, proportional fallback with explicit warning).
- **Clock:** Engine owns performed time; React reads `currentTime` from engine callbacks (not render-driven scheduling).
- **Rate:** 0.25–1.5× on transport; metronome ticks from performed beats.

## Cursor resolver (`src/features/score-follow/resolveScoreFollowCursor.js`)

Pure function: `(timingMap, practiceTime, trustedAnchors) → { cursor, needsSetup, confidence }`.

- Exact trusted anchor when present for current measure.
- Interpolation between neighboring anchors across gaps (gaps do **not** flip needs-setup).
- Start-lock only for `practiceTime ≤ 0.15s`.
- Display smoothing in `useScoreFollowDisplayCursor.js` (target-chase; snap on seek).

**Shared geometry:** Wait For You note targets call the same resolver for page/x/y baseline (`noteTargetPosition.js`).

## Anchor trust and calibration

- **Manual markers** — highest trust; never overwritten.
- **Semi-auto** — PDF staff-system detection (`semiAutoScoreAlignment.js`); users tap system starts.
- **MusicXML layout promotion** — system-span pairs → per-measure anchors when layout confidence passes (`musicxmlLayoutAnchors.js`).
- **Demo bundled anchors** — pre-calibrated sample piece only.

## Testing

```bash
npm test          # Vitest unit/regression (59 tests)
npm run build     # production build
npm run lint      # ESLint
npm run test:scripts  # optional script harnesses
```

Fixtures in `tests/helpers/buildXml.js` encode MusicXML edge cases (repeats, tempo, pickups).

## Supported formats

- **PDF** — display via react-pdf
- **MusicXML / MXL** — timing, repeats, playback synthesis
- **MIDI** — optional backing track (mapped to score clock)
- **Bundled demo** — Minuet in G with pre-built anchors

## Known limitations

- D.C./D.S./Fine/Coda navigation not interpreted (diagnostic surfaced).
- Low-confidence MIDI mapping uses proportional fallback (user-visible warning).
- Count-in not implemented.
- iPad Safari audio/cursor requires manual verification (see completion report checklist).
- Staff detection quality varies on engraved vs. scanned PDFs.

## iPad Safari

Capability probes gate playback (not user-agent blocking). User gesture unlocks Web Audio. Page follow suspends 2s after user scroll. Touch-friendly control sizing preserved from existing CSS.
