/** MusicXML dynamics markings → normalized MIDI-style velocity (0–1). */
export const DYNAMICS_TO_VELOCITY = {
  ppp: 0.22,
  pp: 0.36,
  p: 0.46,
  mp: 0.56,
  mf: 0.7,
  f: 0.82,
  ff: 0.91,
  fff: 0.98,
  sf: 0.9,
  sff: 0.93,
  sfp: 0.78,
  sfpp: 0.72,
  fp: 0.8,
  rf: 0.76,
  rfz: 0.8,
}

export const DEFAULT_MUSICXML_VELOCITY = DYNAMICS_TO_VELOCITY.mf

export function velocityFromDynamicsMark(mark) {
  if (mark == null || mark === '') {
    return null
  }
  const key = String(mark).trim().toLowerCase()
  return DYNAMICS_TO_VELOCITY[key] ?? null
}

/**
 * Parse a <direction> node's <dynamics> child into a 0–1 velocity.
 */
export function dynamicsFromDirection(directionNode, { findChildren, childNodes, childText }) {
  if (!directionNode) {
    return null
  }

  for (const directionType of findChildren(directionNode, 'direction-type')) {
    const dynamics = findChildren(directionType, 'dynamics')[0]
    if (!dynamics) {
      continue
    }

    for (const child of childNodes(dynamics)) {
      if (child.tag === 'other-dynamics') {
        const text = String(child.text ?? '').trim()
        const fromText = velocityFromDynamicsMark(text)
        if (fromText != null) {
          return fromText
        }
        continue
      }
      const fromTag = velocityFromDynamicsMark(child.tag)
      if (fromTag != null) {
        return fromTag
      }
    }
  }

  return null
}
