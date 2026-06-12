import { asNumber, ensureArray } from './xmlUtils.js'

function parseSoundTempo(soundNode) {
  if (!soundNode) {
    return null
  }
  const tempo = asNumber(soundNode['@_tempo'], NaN)
  if (Number.isFinite(tempo) && tempo > 0) {
    return tempo
  }
  return null
}

function parseMetronome(metronomeNode) {
  if (!metronomeNode) {
    return null
  }

  const perMinute = asNumber(metronomeNode['per-minute'], NaN)
  if (Number.isFinite(perMinute) && perMinute > 0) {
    return perMinute
  }

  const beatUnit = metronomeNode['beat-unit'] ?? 'quarter'
  const perMinuteDot = metronomeNode['per-minute']?.['#text']

  if (perMinuteDot && beatUnit === 'quarter') {
    const dotted = asNumber(perMinuteDot, NaN)
    if (Number.isFinite(dotted) && dotted > 0) {
      return dotted
    }
  }

  return null
}

export function extractTempoFromDirection(directionNode) {
  const directions = ensureArray(directionNode)

  for (const direction of directions) {
    const soundTempo = parseSoundTempo(direction.sound)
    if (soundTempo) {
      return soundTempo
    }

    const types = ensureArray(direction['direction-type'])
    for (const directionType of types) {
      const metronome = parseMetronome(directionType.metronome)
      if (metronome) {
        return metronome
      }
    }
  }

  return null
}
