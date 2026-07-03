/**
 * Begin fetching/decoding instrument samples during browser idle time so the
 * first Play uses the sampled voice without delaying app startup.
 */
import {
  getInstrument,
  listInstruments,
  normalizeInstrumentId,
} from '../instruments/instruments.js'
import {
  loadInstrumentVoiceModule,
  voicePreloadFromModule,
} from './instrumentVoices.js'

const warmedInstruments = new Set()

function scheduleIdle(run) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 3000 })
  } else {
    window.setTimeout(run, 800)
  }
}

function warmupInstrumentBuffers(instrumentId) {
  const key = normalizeInstrumentId(instrumentId)
  if (warmedInstruments.has(key) || typeof window === 'undefined') {
    return
  }
  warmedInstruments.add(key)

  scheduleIdle(() => {
    const voiceId = getInstrument(key).voiceId
    Promise.all([import('tone'), loadInstrumentVoiceModule(voiceId)])
      .then(([toneModule, voiceModule]) =>
        voicePreloadFromModule(voiceModule)?.({ tone: toneModule }),
      )
      .catch(() => {
        // Non-fatal — playback falls back to the synth voice.
      })
  })
}

/** Warm one instrument's shared sample buffers (once per session). */
export function warmupInstrumentSamplesOnIdle(instrumentId) {
  warmupInstrumentBuffers(instrumentId)
}

/** Warm every supported instrument so switching Piano ↔ Guitar stays sampled. */
export function warmupAllInstrumentSamplesOnIdle() {
  for (const instrument of listInstruments()) {
    warmupInstrumentBuffers(instrument.id)
  }
}

/** Test-only reset. */
export function __resetInstrumentSampleWarmupForTests() {
  warmedInstruments.clear()
}
