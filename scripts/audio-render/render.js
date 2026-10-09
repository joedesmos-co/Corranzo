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
import { parseMusicXml } from '/src/features/musicxml/parseMusicXml.js'
import { buildScoreNoteSchedule } from '/src/features/playback/scorePlaybackSchedule.js'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function midiToName(midi) {
  const safe = Math.round(midi)
  return `${NOTE_NAMES[((safe % 12) + 12) % 12]}${Math.floor(safe / 12) - 1}`
}

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
  async renderNotes(voiceId, notes, tailSeconds = 2.5, sampleBase = null) {
    const factory = FACTORIES[voiceId]
    if (!factory) {
      throw new Error(`unknown voice: ${voiceId}`)
    }
    const lastEnd = notes.reduce((max, note) => Math.max(max, note.time + note.duration), 0)
    const duration = lastEnd + tailSeconds
    const rendered = await Tone.Offline(async () => {
      const voice = factory({
        tone: Tone,
        sampleBaseUrl: sampleBase ?? BASE_URLS[voiceId],
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

  async render(spec) {
    return this.renderNotes(spec.voice, spec.notes ?? [], spec.tailSeconds ?? 2.5, spec.sampleBase ?? null)
  },

  /**
   * End-to-end: parse MusicXML → build the REAL performance schedule →
   * render it. The returned schedule summary lets tests assert the
   * schedule→audio linkage (every event rendered at its scheduled time).
   */
  async renderSchedule({ musicXml, voice, instrumentId = null, sustainPedal = false, tailSeconds = 2.5 }) {
    const timing = parseMusicXml(musicXml, 'harness.musicxml')
    const events = buildScoreNoteSchedule(timing, { sustainPedal, instrumentId })
    const notes = events.map((event) => ({
      name: midiToName(event.midi),
      time: event.scoreTimeSeconds,
      duration: event.performedDurationSeconds,
      velocity: event.velocity,
      muted: event.muted,
    }))
    const rendered = await this.renderNotes(voice, notes, tailSeconds)
    return {
      ...rendered,
      schedule: events.map((event) => ({
        midi: event.midi,
        time: event.scoreTimeSeconds,
        duration: event.performedDurationSeconds,
        performedDurationSeconds: event.performedDurationSeconds,
        writtenDurationSeconds: event.writtenDurationSeconds,
        velocity: event.velocity,
        muted: event.muted,
        performedTechniques: event.performedTechniques,
        recognizedOnlyTechniques: event.recognizedOnlyTechniques,
      })),
    }
  },
}
