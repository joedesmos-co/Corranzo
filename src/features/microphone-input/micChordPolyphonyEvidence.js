/**
 * Chord collection evidence (Step 5 launch sprint).
 *
 * The production Wait-For-You chord path collects expected tones over a
 * window (waitForYouMicChordCollection). It was fed ONE pitch per frame
 * — the monophonic autocorrelation pitch — so a three-note chord could
 * only ever contribute one tone at a time and real chords frequently
 * never completed (browser-measured: the real C-major triad never
 * completes in the v2/collection path).
 *
 * The v2 score-informed engine already computes POLYPHONIC evidence per
 * frame (`v2DetectedMidis`). Those detections are, by construction, a
 * subset of the EXPECTED pitches (the scorer only scores expected
 * notes), so feeding them into the collection cannot introduce a
 * non-expected tone: the wrong-streak protection is untouched.
 *
 * Pure helper: no React, no audio APIs.
 */

/**
 * Tones to feed the chord collection for one frame.
 *
 * @param {object} frame mic frame (v2DetectedMidis, midi)
 * @param {number[]} expectedMidis checkpoint expectations
 * @returns {number[]} expected-matching tones, de-duplicated
 */
export function chordCollectionEvidenceMidis(frame, expectedMidis = []) {
  const expected = new Set(expectedMidis)
  const tones = []
  for (const midi of frame?.v2DetectedMidis ?? []) {
    if (Number.isFinite(midi) && expected.has(midi) && !tones.includes(midi)) {
      tones.push(midi)
    }
  }
  // The monophonic pitch still matters: it is the only evidence when the
  // v2 polyphonic path is inactive (older frames, fallback engines).
  const played = frame?.midi
  if (Number.isFinite(played) && expected.has(played) && !tones.includes(played)) {
    tones.push(played)
  }
  return tones
}
