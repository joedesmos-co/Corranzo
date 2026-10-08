/**
 * Browser-harness stub for @tonejs/midi (Stage 6, N1/N6) — test-only.
 *
 * basic-pitch-ts `toMidi.js` imports Midi at module load but only uses it
 * inside generateFileData (MIDI file export), which the harness never
 * calls. This stub satisfies the static import without pulling the
 * CommonJS-only @tonejs/midi build into the browser ESM graph.
 */
export class Midi {
  constructor() {
    throw new Error('tonejs-stub Midi is not usable in the browser harness')
  }
}
