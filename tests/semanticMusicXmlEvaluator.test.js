import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as F from './helpers/buildXml.js'
import {
  evaluateSemanticMusicXml,
  extractInterpretationMarks,
  formatSemanticMusicXmlReport,
} from '../src/features/omr/semanticMusicXmlEvaluator.js'

function pitchXml({
  step,
  alter = null,
  octave = 4,
  duration = 4,
  voice = 1,
  type = 'quarter',
  dots = 0,
  notations = '',
}) {
  const alterXml = alter == null ? '' : `<alter>${alter}</alter>`
  const dotXml = '<dot/>'.repeat(dots)
  return (
    `<note>` +
    `<pitch><step>${step}</step>${alterXml}<octave>${octave}</octave></pitch>` +
    `<duration>${duration}</duration><voice>${voice}</voice><type>${type}</type>${dotXml}` +
    `${notations}</note>`
  )
}

function restXml({ duration = 4, voice = 1, type = 'quarter' } = {}) {
  return `<note><rest/><duration>${duration}</duration><voice>${voice}</voice><type>${type}</type></note>`
}

function measure(number, inner, { first = false } = {}) {
  return `<measure number="${number}">${first ? F.attributes({ divisions: 4 }) + F.soundTempo(120) : ''}${inner}</measure>`
}

function score(measures) {
  return F.scoreWrap(`<part id="P1">${measures.join('')}</part>`)
}

const tieStart = '<tie type="start"/><notations><tied type="start"/></notations>'
const staccato = '<notations><articulations><staccato/></articulations></notations>'

describe('semantic MusicXML evaluator', () => {
  it('scores identical scores at 100% across classes', () => {
    const xml = score([
      measure(
        1,
        [
          pitchXml({ step: 'C' }),
          pitchXml({ step: 'D' }),
          pitchXml({ step: 'E' }),
          pitchXml({ step: 'F' }),
        ].join(''),
        { first: true },
      ),
    ])

    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: xml,
      generatedMusicXml: xml,
    })

    expect(report.classes.pitch.percent).toBe('100%')
    expect(report.classes.rhythm.percent).toBe('100%')
    expect(report.classes.measureStructure.percent).toBe('100%')
    expect(report.measures).toEqual([])
    expect(report.topDefects).toEqual([])
  })

  it('reports missing ties, duration mismatches, and missing staccato per measure', () => {
    const truth = score([
      measure(
        5,
        [
          pitchXml({ step: 'C', duration: 8, type: 'half', notations: tieStart }),
          pitchXml({ step: 'D', duration: 4, type: 'quarter', notations: staccato }),
          pitchXml({ step: 'E', duration: 4, type: 'quarter' }),
        ].join(''),
        { first: true },
      ),
      measure(
        6,
        [
          pitchXml({ step: 'C', duration: 4 }),
          pitchXml({ step: 'D', duration: 4, notations: staccato }),
          restXml({ duration: 8, type: 'half' }),
        ].join(''),
      ),
    ])

    const generated = score([
      measure(
        5,
        [
          pitchXml({ step: 'C', duration: 8, type: 'half' }),
          pitchXml({ step: 'D', duration: 2, type: 'eighth' }),
          restXml({ duration: 2, type: 'eighth' }),
          pitchXml({ step: 'E', duration: 4, type: 'quarter' }),
        ].join(''),
        { first: true },
      ),
      measure(
        6,
        [
          pitchXml({ step: 'C', duration: 4 }),
          pitchXml({ step: 'D', duration: 4 }),
          restXml({ duration: 4, type: 'quarter' }),
        ].join(''),
      ),
    ])

    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })

    expect(report.scores.pitch).toBeGreaterThan(0.8)
    expect(report.scores.sustain).toBeLessThan(1)
    expect(report.scores.articulation).toBeLessThan(1)
    expect(report.scores.rhythm).toBeLessThan(1)

    const measure5 = report.measures.find((entry) => entry.measureNumber === 5)
    const measure6 = report.measures.find((entry) => entry.measureNumber === 6)
    expect(measure5?.summary.some((message) => /Missing tie/i.test(message))).toBe(true)
    expect(
      measure5?.summary.some((message) => /quarter detected as eighth/i.test(message)),
    ).toBe(true)
    expect(measure6?.summary.some((message) => /Missing staccato/i.test(message))).toBe(true)
    expect(
      measure6?.summary.some((message) => /Rest duration incorrect/i.test(message)),
    ).toBe(true)

    const text = formatSemanticMusicXmlReport(report)
    expect(text).toContain('Overall semantic score')
    expect(text).toContain('Top recurring defects:')
    expect(text).toMatch(/Pitch\s+\.+\s+\d+%/)
  })

  it('extracts D.C. / segno interpretation marks', () => {
    const xml = score([
      measure(
        1,
        `${pitchXml({ step: 'C' })}${pitchXml({ step: 'D' })}${pitchXml({ step: 'E' })}${pitchXml({ step: 'F' })}` +
          `<direction><direction-type><segno/></direction-type></direction>`,
        { first: true },
      ),
      measure(
        2,
        `${pitchXml({ step: 'G' })}${pitchXml({ step: 'A' })}${pitchXml({ step: 'B' })}${pitchXml({ step: 'C', octave: 5 })}` +
          `<direction><direction-type><words>D.C. al Fine</words></direction-type><sound dacapo="yes"/></direction>`,
      ),
    ])
    const marks = extractInterpretationMarks(xml)
    expect(marks.some((mark) => mark.kind === 'segno')).toBe(true)
    expect(marks.some((mark) => mark.kind === 'dacapo')).toBe(true)
  })

  it('runs the developer CLI in generated-file comparison mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omr-semantic-'))
    const xml = score([
      measure(
        1,
        [
          pitchXml({ step: 'C' }),
          pitchXml({ step: 'D' }),
          pitchXml({ step: 'E' }),
          pitchXml({ step: 'F' }),
        ].join(''),
        { first: true },
      ),
    ])
    const truthPath = join(dir, 'truth.musicxml')
    const generatedPath = join(dir, 'generated.musicxml')
    const jsonPath = join(dir, 'report.json')
    const textPath = join(dir, 'report.txt')
    writeFileSync(truthPath, xml)
    writeFileSync(generatedPath, xml)

    execFileSync('node', [
      'scripts/evaluate-omr-semantic.mjs',
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
    expect(report.kind).toBe('semantic-musicxml-evaluation')
    expect(report.schemaVersion).toBe(2)
    expect(report.classes.pitch.percent).toBe('100%')
    expect(readFileSync(textPath, 'utf8')).toContain('OMR semantic evaluation')
  })
})
