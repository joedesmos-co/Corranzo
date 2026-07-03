/**
 * Legacy piano-named warmup entry — delegates to the instrument-generic
 * warmup with the piano voice. Kept for existing imports/tests.
 */
import {
  warmupInstrumentSamplesOnIdle,
  __resetInstrumentSampleWarmupForTests,
} from './instrumentSampleWarmup.js'
import { DEFAULT_INSTRUMENT_ID } from '../instruments/instruments.js'

export function warmupPianoSamplesOnIdle() {
  warmupInstrumentSamplesOnIdle(DEFAULT_INSTRUMENT_ID)
}

/** Test-only reset. */
export function __resetPianoSampleWarmupForTests() {
  __resetInstrumentSampleWarmupForTests()
}
