/**
 * Instrument-aware microphone defaults.
 *
 * The selected instrument is already known (piano or guitar), so we can pick a
 * couple of sensible mic knobs from it instead of asking the user anything.
 * This is deliberately small — NOT a setup wizard. Electric vs acoustic and
 * clean vs distorted are *signal* properties handled adaptively (see
 * micSignalShape.js); the instrument only sets articulation-level defaults:
 *
 *   - piano  → sustained tones, standard attack skip and gate.
 *   - guitar → plucky attacks that settle fast; slightly quicker attack skip
 *              and a touch more forgiving gate for decaying low strings.
 */
import { INSTRUMENT_IDS, normalizeInstrumentId } from '../instruments/instruments.js'
import { DEFAULT_GATE_OPTIONS } from './micNoiseGate.js'

export const MIC_INSTRUMENT_PROFILES = {
  [INSTRUMENT_IDS.PIANO]: {
    id: INSTRUMENT_IDS.PIANO,
    articulation: 'sustained',
    gate: { absoluteMin: 0.012, floorMultiplier: 2.8 },
    stabilizer: { attackFrames: 2 },
  },
  [INSTRUMENT_IDS.GUITAR]: {
    id: INSTRUMENT_IDS.GUITAR,
    articulation: 'plucky',
    // Plucky low strings decay fast and can read a bit quieter than a held
    // piano note — open the gate a touch sooner, and skip a shorter attack.
    gate: { absoluteMin: 0.011, floorMultiplier: 2.6 },
    stabilizer: { attackFrames: 1 },
  },
}

const FALLBACK_PROFILE = {
  id: normalizeInstrumentId(),
  articulation: 'sustained',
  gate: { ...DEFAULT_GATE_OPTIONS },
  stabilizer: { attackFrames: 2 },
}

/** Resolve a mic profile from any instrument id (defaults to piano). */
export function getMicInstrumentProfile(instrumentId) {
  const id = normalizeInstrumentId(instrumentId)
  return MIC_INSTRUMENT_PROFILES[id] ?? FALLBACK_PROFILE
}
