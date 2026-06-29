import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MUSICXML_VELOCITY,
  dynamicsFromDirection,
  velocityFromDynamicsMark,
} from '../src/features/musicxml/dynamicsMap.js'
import {
  childNodes,
  childText,
  findChildren,
  parseXmlOrdered,
  rootElement,
} from '../src/features/musicxml/xmlTree.js'

function directionFromXml(xml) {
  const doc = parseXmlOrdered(xml)
  return rootElement(doc, 'direction')
}

describe('MusicXML dynamics mapping', () => {
  it('maps standard dynamic marks to velocity', () => {
    expect(velocityFromDynamicsMark('pp')).toBeCloseTo(0.36, 6)
    expect(velocityFromDynamicsMark('f')).toBeCloseTo(0.82, 6)
    expect(velocityFromDynamicsMark('unknown')).toBeNull()
  })

  it('parses dynamics from a direction node', () => {
    const direction = directionFromXml(
      `<direction><direction-type><dynamics><p/></dynamics></direction-type></direction>`,
    )
    const velocity = dynamicsFromDirection(direction, {
      findChildren,
      childNodes,
      childText,
    })
    expect(velocity).toBeCloseTo(0.46, 6)
  })

  it('defaults to mf when no dynamics are present', () => {
    expect(DEFAULT_MUSICXML_VELOCITY).toBeCloseTo(0.7, 6)
  })
})
