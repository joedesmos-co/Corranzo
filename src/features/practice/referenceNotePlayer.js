import * as Tone from 'tone'
import { startToneFromUserGesture } from '../audio/toneAudioUnlock.js'
import { isFiniteMidi } from '../playback/sanitizePlaybackNote.js'
import { getInstrument, normalizeInstrumentId } from '../instruments/instruments.js'
import {
  loadInstrumentVoiceModule,
  voiceFactoryFromModule,
  voicePreloadFromModule,
} from '../playback/instrumentVoices.js'
import { mapPlaybackVelocity } from '../playback/pianoVelocity.js'
import {
  REFERENCE_PLAYBACK_READINESS_MS,
  REFERENCE_VELOCITY_INPUT,
} from '../playback/playbackAudioConfig.js'

/**
 * "Hear it" reference playback for Wait For You checkpoints.
 *
 * Uses the same sampled instrument voices as main playback (resolved through
 * the voice registry — never a bare synth), cached per instrument so switching
 * between piano and guitar keeps both warm.
 */
const referenceVoices = new Map() // instrumentId → { instrument, connected, voiceId }

async function getReferenceVoice(instrumentId) {
  const instrumentKey = normalizeInstrumentId(instrumentId)
  let entry = referenceVoices.get(instrumentKey)
  if (!entry) {
    const { voiceId } = getInstrument(instrumentKey)
    const module = await loadInstrumentVoiceModule(voiceId)
    const createInstrumentVoice = voiceFactoryFromModule(module)
    if (typeof createInstrumentVoice !== 'function') {
      throw new Error(`${voiceId} voice factory unavailable`)
    }
    entry = {
      voiceId: module.VOICE_ID ?? voiceId,
      instrument: createInstrumentVoice({ tone: Tone }),
      connected: false,
    }
    referenceVoices.set(instrumentKey, entry)
    entry.instrument.load?.()
  }
  return entry
}

function connectVoiceToDestination(entry) {
  const { instrument } = entry
  if (!entry.connected && instrument?.output) {
    if (typeof instrument.output.toDestination === 'function') {
      instrument.output.toDestination()
    } else {
      instrument.output.connect?.(Tone.Destination)
    }
    entry.connected = true
  }
}

function midiToNoteName(midi) {
  return Tone.Frequency(midi, 'midi').toNote()
}

/**
 * Preload shared sample buffers for Hear It without wiring audio output.
 * The cached voice is created on first user click (after gesture unlock).
 */
export async function warmupReferenceVoice(instrumentId) {
  if (typeof window === 'undefined') {
    return
  }
  const instrumentKey = normalizeInstrumentId(instrumentId)
  const { voiceId } = getInstrument(instrumentKey)
  const [toneModule, voiceModule] = await Promise.all([
    import('tone'),
    loadInstrumentVoiceModule(voiceId),
  ])
  await voicePreloadFromModule(voiceModule)?.({ tone: toneModule })
}

/** Release any sounding reference notes without tearing down cached voices. */
export function releaseReferenceVoices(time) {
  const now = typeof time === 'number' ? time : Tone.now?.() ?? 0
  for (const entry of referenceVoices.values()) {
    entry.instrument.releaseAll?.(now)
  }
}

/**
 * Play reference pitch(es) for a checkpoint using Tone.js.
 */
export async function playReferenceMidis(midis, durationSeconds = 0.55, options = {}) {
  const playableMidis = (midis ?? []).filter(isFiniteMidi)
  if (!playableMidis.length) {
    return
  }

  await startToneFromUserGesture()
  const entry = await getReferenceVoice(options.instrumentId)
  connectVoiceToDestination(entry)
  await Promise.race([
    entry.instrument.whenReady?.() ?? Promise.resolve(),
    new Promise((resolve) => globalThis.setTimeout(resolve, REFERENCE_PLAYBACK_READINESS_MS)),
  ])

  const velocity = mapPlaybackVelocity(REFERENCE_VELOCITY_INPUT)
  const names = playableMidis.map((midi) => midiToNoteName(midi))
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0.55
  const now = Tone.now()
  entry.instrument.releaseAll?.(now)
  names.forEach((name) => {
    entry.instrument.triggerAttack(name, now, velocity)
    entry.instrument.triggerRelease(name, now + safeDuration)
  })
}

export function disposeReferencePlayer() {
  for (const entry of referenceVoices.values()) {
    entry.instrument.releaseAll?.()
    entry.instrument.dispose()
  }
  referenceVoices.clear()
}

/** Test-only: inspect which voice module Hear It cached per instrument. */
export function __getReferenceVoiceRoutingForTests(instrumentId) {
  const instrumentKey = normalizeInstrumentId(instrumentId)
  const entry = referenceVoices.get(instrumentKey)
  if (!entry) {
    return null
  }
  return {
    instrumentKey,
    voiceId: entry.voiceId,
  }
}

/** Test-only: clear cached Hear It voices between tests. */
export function __resetReferenceVoiceCacheForTests() {
  referenceVoices.clear()
}
