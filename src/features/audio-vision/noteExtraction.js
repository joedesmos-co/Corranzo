/**
 * Note-extraction calibration (the model's own probabilities -> notes).
 *
 * The library defaults (onset 0.5, frame 0.3, minimum 5 frames) are tuned for
 * general material. Measured on real guitar performances they let harmonic
 * siblings and late echoes through: on the five development takes the
 * arrangement's event F1 was 0.692 with precision 0.719 and 12.8 % of the
 * written notes invented.
 *
 * A sweep over the threshold triple (scripts/audio-vision-threshold-sweep.mjs)
 * chose onset 0.65 / frame 0.50 / minimum 3 frames, and the choice was then
 * CHECKED on five UNSEEN GuitarSet takes:
 *
 *   event F1      0.751 -> 0.807   (+0.056)
 *   precision     0.761 -> 0.906
 *   recall        0.755 -> 0.746   (-0.009)
 *   invented      0.102 -> 0.038   (-63 %)
 *   note density              -19 %
 *   dense takes   0.651 -> 0.708   sparse takes 0.902 -> 0.957
 *
 * The same weights, the same audio - only the reading of the model's evidence
 * changed. The arrangement protects the melody and the bass separately, so
 * this is a note-extraction setting, not an arrangement rule.
 */
export const NOTE_EXTRACTION = Object.freeze({
  onsetThreshold: 0.65,
  frameThreshold: 0.5,
  minNoteFrames: 3,
})
