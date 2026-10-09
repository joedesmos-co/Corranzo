/**
 * Offline audio render harness (Stage S8) — test-only.
 *
 * Renders REAL audio through the app's actual voice modules using
 * Tone.Offline (no user gesture needed, deterministic). The test drives
 * everything through window.__renderApi and analyzes the returned PCM.
 *
 * Spec: { voice: 'piano'|'guitar'|'electric',
 *          sampleBase: '/audio/.../' (optional override),
 *          notes: [{ name, time, duration, velocity, muted? }],
 *          tailSeconds }
 * Returns: { sampleRate, samples: [...], engineType, voices }
 */
import * as Tone from 'tone'
import { createPianoInstrument } from '/src/features/playback/pianoInstrument.js'
import { createGuitarInstrument } from '/src/features/playback/guitarInstrument.js'
import { createElectricGuitarInstrument } from '/src/features/playback/electricGuitarInstrument.js'

const FACTORIES = {
  piano: createPianoInstrument,
  guitar: createGuitarInstrument,
  electric: createElectricGuitarInstrument,
}

const BASE_URLS = {
  piano: '/audio/salamander/',
  guitar: '/audio/guitar-acoustic/',
  electric: '/audio/guitar-electric/',
}

window.__renderApi = {
  async render(spec) {
    const factory = FACTORIES[spec.voice]
    if (!factory) {
      throw new Error(`unknown voice: ${spec.voice}`)
    }
    const notes = spec.notes ?? []
    const tailSeconds = spec.tailSeconds ?? 2.5
    const lastEnd = notes.reduce((max, note) => Math.max(max, note.time + note.duration), 0)
    const duration = lastEnd + tailSeconds
    const rendered = await Tone.Offline(async () => {
      const voice = factory({
        tone: Tone,
        sampleBaseUrl: spec.sampleBase ?? BASE_URLS[spec.voice],
        autoload: true,
      })
      // The shared voice exposes an `output` gain that engines normally
      // route into their mix. In the harness there is no engine, so route
      // it straight to the (offline) destination — otherwise the render
      // is correctly scheduled but silently unconnected.
      try {
        voice.output?.connect?.(Tone.getDestination())
      } catch {
        // Diagnostics only: a routing failure must surface, not silence.
        throw new Error('voice output could not connect to destination')
      }
      try {
        await Promise.race([
          voice.whenReady(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('sample timeout')), 20000)),
        ])
      } catch {
        // Synth fallback still renders — engineType reports honestly.
      }
      for (const note of notes) {
        voice.triggerAttackRelease(note.name, note.duration, note.time, note.velocity ?? 0.8, {
          muted: note.muted ?? false,
        })
      }
      // Tone.Offline renders the full duration regardless; the voice is
      // captured for engine reporting and disposed after readback.
      window.__renderVoice = voice
    }, duration)
    const channel = rendered.getChannelData(0)
    const voice = window.__renderVoice
    window.__renderVoice = null
    const engineType = voice?.isUsingSampler?.() ? 'sampler' : 'synth'
    try {
      voice?.dispose?.()
    } catch {
      // Diagnostics only.
    }
    return {
      sampleRate: rendered.sampleRate,
      samples: Array.from(channel),
      engineType,
    }
  },
}
