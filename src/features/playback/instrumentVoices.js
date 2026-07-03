/**
 * Playback voice registry: instrument voiceId → lazily imported voice module.
 *
 * Every module exports the same canonical surface:
 *   - createInstrumentVoice(options) → engine-facing voice
 *   - preloadSampleBuffers({ tone })  → warm the shared buffer cache
 *   - INSTRUMENT_STATUS_LABEL         → status → user copy
 *
 * Engines resolve voices exclusively through this registry, so adding an
 * instrument means adding a module + one entry here — no engine changes.
 */

const VOICE_MODULE_LOADERS = {
  piano: () => import('./pianoInstrument.js'),
  guitar: () => import('./guitarInstrument.js'),
}

const FALLBACK_VOICE_ID = 'piano'

export function isKnownVoiceId(voiceId) {
  return typeof voiceId === 'string' && Object.hasOwn(VOICE_MODULE_LOADERS, voiceId)
}

/** Resolve a voice module loader; unknown ids fall back to the piano voice. */
export function getVoiceModuleLoader(voiceId) {
  return VOICE_MODULE_LOADERS[isKnownVoiceId(voiceId) ? voiceId : FALLBACK_VOICE_ID]
}

/** Load a voice module (normalized: unknown ids → piano). */
export function loadInstrumentVoiceModule(voiceId) {
  return getVoiceModuleLoader(voiceId)()
}

/**
 * Extract the canonical factory from a voice module, tolerating legacy
 * piano-named exports (test fakes inject `{ createPianoInstrument }`).
 */
export function voiceFactoryFromModule(module) {
  return module?.createInstrumentVoice ?? module?.createPianoInstrument ?? null
}

/** Extract the canonical preload, tolerating legacy piano-named exports. */
export function voicePreloadFromModule(module) {
  return module?.preloadSampleBuffers ?? module?.preloadPianoSampleBuffers ?? null
}
