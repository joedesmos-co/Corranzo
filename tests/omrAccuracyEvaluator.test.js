import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as F from './helpers/buildXml.js'
import {
  evaluateOmrAccuracy,
  formatOmrAccuracyReport,
  OMR_ACCURACY_SOURCE,
} from '../src/features/omr/omrAccuracyEvaluator.js'

function pitchXml({ step, alter = null, octave = 4, duration = 4, chord = false }) {
  const alterXml = alter == null ? '' : `<alter>${alter}</alter>`
  return (
    `<note>${chord ? '<chord/>' : ''}` +
    `<pitch><step>${step}</step>${alterXml}<octave>${octave}</octave></pitch>` +
    `<duration>${duration}</duration><voice>1</voice><type>quarter</type></note>`
  )
}

function measure(number, inner, { first = false } = {}) {
  return `<measure number="${number}">${first ? F.attributes({ divisions: 4 }) + F.soundTempo(120) : ''}${inner}</measure>`
}

function score(measures) {
  return F.scoreWrap(`<part id="P1">${measures.join('')}</part>`)
}

function fourNoteMeasure(number, notes, options = {}) {
  return measure(
    number,
    notes
      .map((note) =>
        pitchXml({
          step: note.step,
          alter: note.alter ?? null,
          octave: note.octave ?? 4,
          duration: note.duration ?? 4,
          chord: note.chord ?? false,
        }),
      )
      .join(''),
    options,
  )
}

const baseMeasure = [
  { step: 'C' },
  { step: 'D' },
  { step: 'E' },
  { step: 'F' },
]

describe('OMR accuracy evaluator', () => {
  it('reports perfect metrics for identical generated and ground-truth scores', () => {
    const xml = score([
      fourNoteMeasure(1, baseMeasure, { first: true }),
      fourNoteMeasure(2, baseMeasure),
    ])

    const report = evaluateOmrAccuracy({
      generatedMusicXml: xml,
      groundTruthMusicXml: xml,
    })

    expect(report.metrics.pitchAccuracy).toBe(1)
    expect(report.metrics.durationAccuracy).toBe(1)
    expect(report.metrics.onsetAccuracy).toBe(1)
    expect(report.metrics.measureCountAccuracy).toBe(1)
    expect(report.summary.primaryErrorSource.source).toBe(OMR_ACCURACY_SOURCE.NONE)
    expect(report.summary.firstAlignmentBreak).toBe(null)
  })

  it('surfaces wrong pitches, wrong durations, missing notes, and extra notes', () => {
    const truth = score([fourNoteMeasure(1, baseMeasure, { first: true })])
    const generated = score([
      fourNoteMeasure(
        1,
        [
          { step: 'C' },
          { step: 'D', alter: 1 },
          { step: 'E', duration: 8 },
          { step: 'G' },
        ],
        { first: true },
      ),
    ])

    const report = evaluateOmrAccuracy({
      generatedMusicXml: generated,
      groundTruthMusicXml: truth,
    })

    expect(report.totals.wrongPitchCount).toBeGreaterThan(0)
    expect(report.totals.wrongDurationCount).toBeGreaterThan(0)
    expect(report.totals.missingNoteCount).toBeGreaterThan(0)
    expect(report.totals.extraNoteCount).toBeGreaterThan(0)
    expect(report.debug.wrongPitches[0].truth.label).toBe('D4')
    expect(formatOmrAccuracyReport(report)).toContain('Worst measures')
  })

  it('identifies notehead detection when generated notes are mostly missing', () => {
    const truth = score([
      fourNoteMeasure(1, baseMeasure, { first: true }),
      fourNoteMeasure(2, baseMeasure),
    ])
    const generated = score([
      fourNoteMeasure(1, [{ step: 'C' }, { step: 'D' }], { first: true }),
    ])

    const report = evaluateOmrAccuracy({
      generatedMusicXml: generated,
      groundTruthMusicXml: truth,
    })

    expect(report.summary.primaryErrorSource.source).toBe(OMR_ACCURACY_SOURCE.NOTEHEAD_DETECTION)
    expect(report.metrics.noteDetectionRecall).toBeLessThan(0.5)
  })

  it('identifies pitch mapping when onsets and durations are right but pitches are wrong', () => {
    const truth = score([fourNoteMeasure(1, baseMeasure, { first: true })])
    const generated = score([
      fourNoteMeasure(
        1,
        [
          { step: 'C', alter: 1 },
          { step: 'D', alter: 1 },
          { step: 'F' },
          { step: 'F', alter: 1 },
        ],
        { first: true },
      ),
    ])

    const report = evaluateOmrAccuracy({
      generatedMusicXml: generated,
      groundTruthMusicXml: truth,
    })

    expect(report.summary.primaryErrorSource.source).toBe(OMR_ACCURACY_SOURCE.PITCH_MAPPING)
    expect(report.totals.wrongPitchCount).toBe(4)
    expect(report.metrics.durationAccuracy).toBe(1)
  })

  it('identifies measure allocation when measure counts diverge', () => {
    const truth = score([
      fourNoteMeasure(1, baseMeasure, { first: true }),
      fourNoteMeasure(2, baseMeasure),
    ])
    const generated = score([
      fourNoteMeasure(1, [...baseMeasure, ...baseMeasure], { first: true }),
    ])

    const report = evaluateOmrAccuracy({
      generatedMusicXml: generated,
      groundTruthMusicXml: truth,
    })

    expect(report.summary.primaryErrorSource.source).toBe(OMR_ACCURACY_SOURCE.MEASURE_ALLOCATION)
    expect(report.totals.measureCountDifference).toBe(-1)
    expect(report.summary.firstAlignmentBreak?.measureNumber).toBe(1)
  })

  it('runs the developer CLI in generated-file comparison mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omr-accuracy-'))
    const truth = score([fourNoteMeasure(1, baseMeasure, { first: true })])
    const generated = truth
    const truthPath = join(dir, 'truth.musicxml')
    const generatedPath = join(dir, 'generated.musicxml')
    const jsonPath = join(dir, 'report.json')
    const textPath = join(dir, 'report.txt')
    writeFileSync(truthPath, truth)
    writeFileSync(generatedPath, generated)

    execFileSync('node', [
      'scripts/evaluate-omr-accuracy.mjs',
      '--generated',
      generatedPath,
      '--truth',
      truthPath,
      '--json',
      jsonPath,
      '--text',
      textPath,
    ])

    expect(existsSync(jsonPath)).toBe(true)
    expect(existsSync(textPath)).toBe(true)
    const report = JSON.parse(readFileSync(jsonPath, 'utf8'))
    expect(report.metrics.pitchAccuracy).toBe(1)
    expect(readFileSync(textPath, 'utf8')).toContain('OMR accuracy report')
  })
})
