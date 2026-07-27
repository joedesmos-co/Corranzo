import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  categorizePitchDeltaSemitones,
  classifyPitchErrorRootCause,
  PITCH_ERROR_CATEGORY,
  PITCH_ROOT_CAUSE,
  summarizePitchErrorRootCauses,
  summarizePitchErrors,
} from '../src/features/omr/omrPitchErrorAnalysis.js'
import { normalizedStaffLineYs, filterViableStaves, groupStavesIntoSystems } from '../src/features/score-follow/detectStaffLines.js'
import {
  midiFromStaffPosition,
  resolveNoteheadYNorm,
  resolvePitchFromGrandStaff,
  staffSpanWithLedger,
} from '../src/features/omr/pitchFromStaffPosition.js'

const GRAND_STAFF = {
  treble: [0.134, 0.14, 0.146, 0.152, 0.158],
  bass: [0.196, 0.202, 0.208, 0.214, 0.22],
  splitY: 0.177,
}

describe('normalizedStaffLineYs', () => {
  it('picks five uniformly spaced rows from oversampled clusters', () => {
    const height = 1000
    const rows = [134, 140, 146, 152, 158, 159]
    const lineYs = normalizedStaffLineYs(rows, height)
    expect(lineYs).toHaveLength(5)
    const gaps = lineYs.slice(1).map((y, index) => y - lineYs[index])
    expect(Math.min(...gaps) / Math.max(...gaps)).toBeGreaterThan(0.75)
  })

  it('returns null when fewer than five rows are available', () => {
    expect(normalizedStaffLineYs([134, 140, 146, 152], 1000)).toBeNull()
  })
})

describe('filterViableStaves', () => {
  it('drops a degenerate ink band so grand-staff pairing can run', () => {
    const staves = [
      { y0: 0.1886, y1: 0.2295, center: 0.209, lineCount: 10 },
      { y0: 0.2921, y1: 0.3331, center: 0.3126, lineCount: 10 },
      { y0: 0.5093, y1: 0.51, center: 0.5097, lineCount: 2 },
      { y0: 0.5294, y1: 0.5703, center: 0.5498, lineCount: 7 },
      { y0: 0.6329, y1: 0.6739, center: 0.6534, lineCount: 8 },
    ]
    const viable = filterViableStaves(staves)
    expect(viable).toHaveLength(4)
    expect(viable.some((stave) => stave.y1 - stave.y0 < 0.01)).toBe(false)
    const systems = groupStavesIntoSystems(viable, 2)
    expect(systems).toHaveLength(2)
    expect(systems.every((system) => system.staveCount === 2)).toBe(true)
  })
})

describe('resolveNoteheadYNorm', () => {
  it('applies a bounded center correction for notehead-sized glyphs', () => {
    const imageData = { height: 1000 }
    const lineYs = GRAND_STAFF.treble
    const glyph = { y: 146, height: 14 }
    const yNorm = resolveNoteheadYNorm(glyph, imageData, lineYs)
    expect(yNorm).toBeLessThan(glyph.y / imageData.height)
    expect(yNorm).toBeGreaterThan((glyph.y - glyph.height) / imageData.height)
  })
})

describe('resolveStaffRoleForY dense grand staff', () => {
  it('clips overlapping ledger spans at the split', () => {
    const trebleSpan = staffSpanWithLedger(GRAND_STAFF.treble, {
      clipBottom: GRAND_STAFF.splitY - 0.002,
    })
    const bassSpan = staffSpanWithLedger(GRAND_STAFF.bass, {
      clipTop: GRAND_STAFF.splitY + 0.002,
    })
    expect(trebleSpan.bottom).toBeLessThan(GRAND_STAFF.splitY)
    expect(bassSpan.top).toBeGreaterThan(GRAND_STAFF.splitY)
  })

  it('maps a dense lower-staff treble-clef note', () => {
    const mapping = resolvePitchFromGrandStaff(0.2148, GRAND_STAFF, {
      upper: 'treble',
      lower: 'treble',
    })
    expect(mapping.clef).toBe('bass')
    expect(mapping.clefSign).toBe('treble')
    expect(mapping.midi).toBe(midiFromStaffPosition(0.2148, GRAND_STAFF.bass, 'treble'))
  })

  it('uses bass clef for noteheads below the lower staff bottom line', () => {
    const mapping = resolvePitchFromGrandStaff(0.233, GRAND_STAFF, {
      upper: 'treble',
      lower: 'treble',
    })
    expect(mapping.clefSign).toBe('bass')
    expect(mapping.midi).toBe(midiFromStaffPosition(0.233, GRAND_STAFF.bass, 'bass'))
  })
})

describe('omrPitchErrorAnalysis', () => {
  it('categorizes interval buckets used in dense benchmarks', () => {
    expect(categorizePitchDeltaSemitones(1)).toBe(PITCH_ERROR_CATEGORY.ACCIDENTAL)
    expect(categorizePitchDeltaSemitones(-2)).toBe(PITCH_ERROR_CATEGORY.DIATONIC_STEP)
    expect(categorizePitchDeltaSemitones(24)).toBe(PITCH_ERROR_CATEGORY.OCTAVE)
    expect(categorizePitchDeltaSemitones(7)).toBe(PITCH_ERROR_CATEGORY.OTHER)
  })

  it('summarizes wrong-pitch histograms', () => {
    const summary = summarizePitchErrors([
      { measureNumber: 1, pitchDeltaSemitones: 2, truth: { label: 'C4' }, generated: { label: 'D4' } },
      { measureNumber: 1, pitchDeltaSemitones: -12, truth: { label: 'C5' }, generated: { label: 'C4' } },
    ])
    expect(summary.total).toBe(2)
    expect(summary.histogram[PITCH_ERROR_CATEGORY.DIATONIC_STEP]).toBe(1)
    expect(summary.histogram[PITCH_ERROR_CATEGORY.OCTAVE]).toBe(1)
  })
})

describe('pitch error root-cause classification', () => {
  it('labels onset-coupled pitch errors as grouping artifacts', () => {
    const bucket = classifyPitchErrorRootCause({
      onsetDiffQuarters: 0.5,
      durationDiffQuarters: 0,
      pitchDeltaSemitones: -1,
      truth: { label: 'A#2' },
      generated: { label: 'A2' },
    })
    expect(bucket).toBe(PITCH_ROOT_CAUSE.GROUPING_ARTIFACT)
  })

  it('labels same-step missing sharps as accidental misses at correct onset', () => {
    const bucket = classifyPitchErrorRootCause({
      onsetDiffQuarters: 0,
      durationDiffQuarters: 0,
      pitchDeltaSemitones: -1,
      truth: { label: 'A#2' },
      generated: { label: 'A2' },
    })
    expect(bucket).toBe(PITCH_ROOT_CAUSE.ACCIDENTAL_MISS)
  })

  it('labels large register slips as staff/clef/register pairing', () => {
    const bucket = classifyPitchErrorRootCause({
      onsetDiffQuarters: 0,
      durationDiffQuarters: 0,
      pitchDeltaSemitones: -21,
      truth: { label: 'C4' },
      generated: { label: 'D#2' },
    })
    expect(bucket).toBe(PITCH_ROOT_CAUSE.STAFF_CLEF_REGISTER)
  })

  it('does not promote accidentals to the primary dense root cause', () => {
    const fixturePath = join(
      process.cwd(),
      'tmp/omr-benchmark-dashboard/fixtures/dense.json',
    )
    if (!existsSync(fixturePath)) {
      return
    }
    const report = JSON.parse(readFileSync(fixturePath, 'utf8'))
    const summary = summarizePitchErrorRootCauses(report.debug?.wrongPitches ?? [])
    expect(summary.total).toBe(147)
    expect(summary.primaryRootCause?.bucket).toBe(PITCH_ROOT_CAUSE.GROUPING_ARTIFACT)
    expect(summary.histogram[PITCH_ROOT_CAUSE.GROUPING_ARTIFACT]).toBeGreaterThanOrEqual(80)
    expect(summary.histogram[PITCH_ROOT_CAUSE.ACCIDENTAL_MISS]).toBeLessThan(15)
    expect(summary.atCorrectOnsetHistogram[PITCH_ROOT_CAUSE.STAFF_CLEF_REGISTER]).toBeGreaterThan(
      summary.atCorrectOnsetHistogram[PITCH_ROOT_CAUSE.ACCIDENTAL_MISS],
    )
  })
})
