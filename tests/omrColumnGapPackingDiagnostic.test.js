import { describe, expect, it } from 'vitest'
import {
  GEOMETRY_FIXTURES,
  traceColumnGapPacking,
} from '../scripts/lib/columnGapPackingTrace.mjs'

/**
 * Diagnostic fixtures only — assert tracer visibility into current baseline
 * behavior. These do not change production recognition.
 */
describe('column gap-packing diagnostic fixtures', () => {
  it('detects chord-column onset divergence under dense group-count snap', () => {
    const fixture = GEOMETRY_FIXTURES.find(
      (entry) => entry.id === 'chord-column-split-during-onset-snap',
    )
    const trace = traceColumnGapPacking(fixture)
    // After the adjacent-slot fix, production reunites the visual triad.
    // The tracer still records whether dense mode was entered via group count.
    expect(typeof trace.denseRhythmEntered).toBe('boolean')
    expect(trace.denseRhythmRule).toBeTruthy()
    const reunited = trace.stages.postCoalesce.some(
      (event) =>
        [60, 64, 67].every((midi) => event.midis.includes(midi)) && event.midis.length >= 3,
    )
    expect(reunited).toBe(true)
  })

  it('keeps mixed-voice near-x stack observable as separate candidates', () => {
    const fixture = GEOMETRY_FIXTURES.find(
      (entry) => entry.id === 'mixed-voice-stack-must-remain-separate',
    )
    const trace = traceColumnGapPacking(fixture)
    expect(trace.columns.some((column) => column.noteIds.length >= 1)).toBe(true)
    // Production may still merge by x; diagnostic records stem directions.
    const stems = trace.columns.flatMap((column) => column.stemDirections)
    expect(stems.includes('up') && stems.includes('down')).toBe(true)
  })

  it('flags when adjacent chord sequence enters dense-rhythm via group count', () => {
    const fixture = GEOMETRY_FIXTURES.find(
      (entry) => entry.id === 'adjacent-dense-chords-no-broad-dense-mode',
    )
    const trace = traceColumnGapPacking(fixture)
    // 4 chord columns with beats=4 → groupCount may equal beats (borderline).
    expect(trace.groupCount).toBeGreaterThanOrEqual(4)
    expect(typeof trace.denseRhythmEntered).toBe('boolean')
    expect(trace.denseRhythmRule).toBeTruthy()
  })

  it('traces whole-chord resnap without modifying production modules', () => {
    const fixture = GEOMETRY_FIXTURES.find((entry) => entry.id === 'whole-chord-resnap-as-unit')
    const trace = traceColumnGapPacking(fixture)
    expect(trace.stages.postResnap.length).toBeGreaterThan(0)
    expect(trace.stages.postPack.length).toBeGreaterThan(0)
  })
})
