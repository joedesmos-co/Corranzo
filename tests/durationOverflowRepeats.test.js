import { describe, expect, it } from 'vitest'
import {
  buildPerformedMeasureTimeline,
  detectUnsafeRepeatExpansion,
} from '../src/features/musicxml/parseMeasureRepeats.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { validateOmrGeneratedPlayback } from '../src/features/omr/validateOmrGeneratedPlayback.js'
import { sanitizeOmrRepeatMarkings } from '../src/features/omr/detectOmrRepeatBarline.js'
import * as F from './helpers/buildXml.js'

function markingsFromSpec(n, spec) {
  const markings = Array.from({ length: n }, () => ({}))
  for (const entry of spec) {
    markings[entry.i] = entry.mark
  }
  return markings
}

function measuresOf(n) {
  return Array.from({ length: n }, (_, i) => ({
    number: i + 1,
    startTimeSeconds: i,
    endTimeSeconds: i + 1,
  }))
}

describe('duration overflow from unsafe OMR repeats', () => {
  it('detects multiple orphan backwards as unsafe', () => {
    const markings = markingsFromSpec(160, [
      { i: 128, mark: { backwardRepeat: true } },
      { i: 133, mark: { backwardRepeat: true } },
      { i: 155, mark: { backwardRepeat: true } },
      { i: 156, mark: { backwardRepeat: true } },
    ])
    expect(detectUnsafeRepeatExpansion(markings).unsafe).toBe(true)
    expect(detectUnsafeRepeatExpansion(markings).reason).toBe(
      'multiple-orphan-backward-repeats',
    )
  })

  it('falls back to written duration instead of maxSteps explosion', () => {
    const markings = markingsFromSpec(157, [
      { i: 128, mark: { backwardRepeat: true } },
      { i: 133, mark: { backwardRepeat: true } },
      { i: 155, mark: { backwardRepeat: true } },
      { i: 156, mark: { backwardRepeat: true } },
    ])
    const tl = buildPerformedMeasureTimeline(measuresOf(157), markings, [])
    expect(tl.diagnostics.usesPerformedTimeline).toBe(false)
    expect(tl.diagnostics.expansionAborted).toBe(true)
    expect(tl.performedDurationSeconds).toBe(157)
    expect(tl.diagnostics.performedMeasureCount).toBe(157)
    expect(tl.diagnostics.performedMeasureCount).toBeLessThan(157 * 4)
  })

  it('still expands a single repeat-to-beginning', () => {
    const markings = markingsFromSpec(51, [{ i: 50, mark: { backwardRepeat: true } }])
    const tl = buildPerformedMeasureTimeline(measuresOf(51), markings, [])
    expect(tl.diagnostics.fullyInterpreted).toBe(true)
    expect(tl.diagnostics.usesPerformedTimeline).toBe(true)
    expect(tl.performedDurationSeconds).toBe(102)
  })

  it('pairs a later backward as orphan after a closed section (finite)', () => {
    const markings = markingsFromSpec(31, [
      { i: 10, mark: { forwardRepeat: true } },
      { i: 20, mark: { backwardRepeat: true } },
      { i: 30, mark: { backwardRepeat: true } },
    ])
    const tl = buildPerformedMeasureTimeline(measuresOf(31), markings, [])
    expect(tl.diagnostics.expansionAborted).toBe(false)
    expect(tl.diagnostics.performedMeasureCount).toBeLessThan(31 * 10)
    expect(tl.performedDurationSeconds).toBeLessThan(31 * 10)
  })

  it('parseMusicXml duration uses written clock when expansion aborts', () => {
    // Malformed open-forward graph stays uncertain; multi-orphan aborts.
    const xml =
      `<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1">` +
      `<measure number="1"><attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes><sound tempo="60"/><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note><barline location="right"><repeat direction="backward"/></barline></measure>` +
      `<measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note><barline location="right"><repeat direction="backward"/></barline></measure>` +
      `<measure number="3"><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure>` +
      `</part></score-partwise>`
    const timing = parseMusicXml(xml)
    expect(timing.performedMeasureTimeline.diagnostics.expansionAborted).toBe(true)
    expect(timing.durationSeconds).toBeCloseTo(timing.writtenDurationSeconds, 6)
    expect(timing.durationSeconds).toBeLessThan(60)
    const validation = validateOmrGeneratedPlayback(xml)
    expect(validation.ok).toBe(true)
  })

  it('OMR sanitize strips unsafe repeat marks before emit', () => {
    const measures = [
      { measureNumber: 1, repeatMarking: { backwardRepeat: true, confidence: 0.84 } },
      { measureNumber: 2, repeatMarking: { backwardRepeat: true, confidence: 0.84 } },
      { measureNumber: 3, repeatMarking: null },
    ]
    const result = sanitizeOmrRepeatMarkings(measures)
    expect(result.stripped).toBe(true)
    expect(result.measures.every((m) => m.repeatMarking == null)).toBe(true)
  })

  it('does not strip a well-formed single repeat section', () => {
    const measures = [
      { measureNumber: 1, repeatMarking: { forwardRepeat: true, confidence: 0.84 } },
      { measureNumber: 2, repeatMarking: { backwardRepeat: true, confidence: 0.84 } },
    ]
    const result = sanitizeOmrRepeatMarkings(measures)
    expect(result.stripped).toBe(false)
    expect(result.measures[0].repeatMarking.forwardRepeat).toBe(true)
    expect(result.measures[1].repeatMarking.backwardRepeat).toBe(true)
  })

  it('keeps legitimate fixture expansions unchanged', () => {
    expect(
      parseMusicXml(F.oneRepeat())
        .performedMeasureTimeline.entries.map((e) => e.writtenMeasureNumber)
        .join(','),
    ).toBe('1,2,1,2,3,4')
    expect(
      parseMusicXml(F.repeatToBeginning())
        .performedMeasureTimeline.entries.map((e) => e.writtenMeasureNumber)
        .join(','),
    ).toBe('1,2,1,2,3')
  })
})
