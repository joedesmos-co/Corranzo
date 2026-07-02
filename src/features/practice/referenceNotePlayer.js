import * as Tone from 'tone'
import { startToneFromUserGesture } from '../audio/toneAudioUnlock.js'

let referenceInstrument = null
let instrumentConnected = false
let createPianoInstrument = null

async function getReferenceInstrument() {
  if (!referenceInstrument) {
    if (!createPianoInstrument) {
      const module = await import('../playback/pianoInstrument.js')
      createPianoInstrument = module.createPianoInstrument
    }
    referenceInstrument = createPianoInstrument({ tone: Tone })
    instrumentConnected = false
  }
  return referenceInstrument
}

function connectInstrumentToDestination(instrument) {
  if (!instrumentConnected && instrument?.output) {
    if (typeof instrument.output.toDestination === 'function') {
      instrument.output.toDestination()
    } else {
      instrument.output.connect?.(Tone.Destination)
    }
    instrumentConnected = true
  }
}

function midiToNoteName(midi) {
  return Tone.Frequency(midi, 'midi').toNote()
}

/**
 * Play reference pitch(es) for a checkpoint using Tone.js.
 */
export async function playReferenceMidis(midis, durationSeconds = 0.55) {
  if (!midis?.length) {
    return
  }

  await startToneFromUserGesture()
  const instrument = await getReferenceInstrument()
  connectInstrumentToDestination(instrument)
  await Promise.race([
    instrument.whenReady?.() ?? Promise.resolve(),
    new Promise((resolve) => globalThis.setTimeout(resolve, 800)),
  ])
  const names = midis.map((midi) => midiToNoteName(midi))
  const now = Tone.now()
  names.forEach((name) => {
    instrument.triggerAttackRelease(name, durationSeconds, now, 0.62)
  })
}

export function disposeReferencePlayer() {
  if (referenceInstrument) {
    referenceInstrument.releaseAll?.()
    referenceInstrument.dispose()
    referenceInstrument = null
    instrumentConnected = false
  }
}
