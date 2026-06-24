import * as Tone from 'tone'
import { startToneFromUserGesture } from '../audio/toneAudioUnlock.js'

let synth = null
let synthConnected = false

function getSynth() {
  if (!synth) {
    synth = new Tone.PolySynth(Tone.Synth, {
      envelope: { attack: 0.02, release: 0.4 },
    })
  }
  return synth
}

function connectSynthToDestination() {
  if (!synthConnected && synth) {
    synth.toDestination()
    synthConnected = true
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
  connectSynthToDestination()
  const names = midis.map((midi) => midiToNoteName(midi))
  getSynth().triggerAttackRelease(names, durationSeconds)
}

export function disposeReferencePlayer() {
  if (synth) {
    synth.dispose()
    synth = null
    synthConnected = false
  }
}
