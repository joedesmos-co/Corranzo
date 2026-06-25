/**
 * Begin fetching/decoding piano samples during browser idle time so the first
 * Play uses the sampled grand piano without delaying app startup.
 */
let warmupStarted = false

export function warmupPianoSamplesOnIdle() {
  if (warmupStarted || typeof window === 'undefined') {
    return
  }
  warmupStarted = true

  const run = () => {
    Promise.all([import('tone'), import('./pianoInstrument.js')])
      .then(([toneModule, pianoModule]) =>
        pianoModule.preloadPianoSampleBuffers({ tone: toneModule }),
      )
      .catch(() => {
        // Non-fatal — playback falls back to the synth voice.
      })
  }

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 5000 })
  } else {
    window.setTimeout(run, 1500)
  }
}

/** Test-only reset. */
export function __resetPianoSampleWarmupForTests() {
  warmupStarted = false
}
