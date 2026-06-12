import { asNumber } from './xmlUtils.js'

const STEP_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export function pitchToMidi(pitchNode) {
  if (!pitchNode) {
    return null
  }

  const step = pitchNode.step
  const octave = asNumber(pitchNode.octave, NaN)
  const alter = asNumber(pitchNode.alter, 0)

  if (!step || !Number.isFinite(octave)) {
    return null
  }

  const stepOffset = STEP_SEMITONES[step.toUpperCase()]
  if (stepOffset == null) {
    return null
  }

  return (octave + 1) * 12 + stepOffset + alter
}

export function noteLabel(pitchNode) {
  if (!pitchNode) {
    return 'rest'
  }
  const alter = asNumber(pitchNode.alter, 0)
  const alterSymbol = alter === 1 ? '#' : alter === -1 ? 'b' : ''
  return `${pitchNode.step}${alterSymbol}${pitchNode.octave}`
}
