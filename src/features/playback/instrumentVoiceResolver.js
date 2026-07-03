/**
 * Shared voice-module resolution for the playback engines.
 *
 * Owns the instrumentId → voice-factory cache and the module loading rules:
 *   - the piano slot can be overridden by the engine's legacy `loadPianoInstrument`
 *     constructor option (the long-standing unit-test seam),
 *   - every other instrument loads through the voice registry,
 *   - factories can be injected directly (tests poke `engine.createPianoInstrument`).
 *
 * Both ScorePlaybackEngine and MidiPlaybackEngine delegate here so the logic
 * exists exactly once.
 */

import {
  DEFAULT_INSTRUMENT_ID,
  getInstrument,
  normalizeInstrumentId,
} from '../instruments/instruments.js'
import {
  loadInstrumentVoiceModule,
  voiceFactoryFromModule,
  voicePreloadFromModule,
} from './instrumentVoices.js'

export function createInstrumentVoiceResolver({ legacyPianoModuleLoader = null } = {}) {
  const factories = new Map()
  let instrumentId = DEFAULT_INSTRUMENT_ID

  function loadModule(id) {
    if (id === DEFAULT_INSTRUMENT_ID && legacyPianoModuleLoader) {
      return Promise.resolve(legacyPianoModuleLoader())
    }
    return loadInstrumentVoiceModule(getInstrument(id).voiceId)
  }

  return {
    get instrumentId() {
      return instrumentId
    },

    /** Returns true when the id actually changed. */
    setInstrumentId(next) {
      const normalized = normalizeInstrumentId(next)
      if (normalized === instrumentId) {
        return false
      }
      instrumentId = normalized
      return true
    },

    getFactory(id = instrumentId) {
      return factories.get(normalizeInstrumentId(id)) ?? null
    },

    setFactory(id, factory) {
      const key = normalizeInstrumentId(id)
      if (factory) {
        factories.set(key, factory)
      } else {
        factories.delete(key)
      }
    },

    /** Load (once) and cache the voice factory for an instrument. */
    async ensureFactory(id = instrumentId) {
      const key = normalizeInstrumentId(id)
      if (!factories.get(key)) {
        const module = await loadModule(key)
        const factory = voiceFactoryFromModule(module)
        if (factory) {
          factories.set(key, factory)
        }
      }
      return factories.get(key) ?? null
    },

    /**
     * Warm the instrument's sample buffers (and cache its factory). Throws on
     * loader failure — callers decide whether that is fatal.
     */
    async preload(tone, id = instrumentId) {
      const key = normalizeInstrumentId(id)
      const module = await loadModule(key)
      const factory = voiceFactoryFromModule(module)
      if (factory && !factories.get(key)) {
        factories.set(key, factory)
      }
      await voicePreloadFromModule(module)?.({ tone })
    },
  }
}
