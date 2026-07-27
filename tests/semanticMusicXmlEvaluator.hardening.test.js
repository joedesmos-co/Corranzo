import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as F from './helpers/buildXml.js'
import {
  assertSemanticSelfCheck,
  evaluateSemanticMusicXml,
  formatCompactSummary,
  SEMANTIC_DEFECT_CODE,
  SEMANTIC_EVAL_SCHEMA_VERSION,
  SEMANTIC_EVALUATOR_VERSION,
} from '../src/features/omr/semanticMusicXmlEvaluator.js'
import { SEMANTIC_EVAL_TOLERANCES } from '../src/features/omr/semanticEvalTolerances.js'
import { alignMeasureSequences, buildMeasureFingerprint } from '../src/features/omr/semanticMeasureAlignment.js'
import { canonicalizeVoices, matchSemanticEvents } from '../src/features/omr/semanticEventMatching.js'

function pitchXml({
  step,
  alter = null,
  octave = 4,
  duration = 4,
  voice = 1,
  staff = null,
  type = 'quarter',
  dots = 0,
  notations = '',
  chord = false,
  extra = '',
}) {
  const alterXml = alter == null ? '' : `<alter>${alter}</alter>`
  const staffXml = staff == null ? '' : `<staff>${staff}</staff>`
  const chordXml = chord ? '<chord/>' : ''
  const dotXml = '<dot/>'.repeat(dots)
  return (
    `<note>${chordXml}` +
    `<pitch><step>${step}</step>${alterXml}<octave>${octave}</octave></pitch>` +
    `<duration>${duration}</duration><voice>${voice}</voice>${staffXml}<type>${type}</type>${dotXml}` +
    `${notations}${extra}</note>`
  )
}

function restXml({ duration = 4, voice = 1, type = 'quarter' } = {}) {
  return `<note><rest/><duration>${duration}</duration><voice>${voice}</voice><type>${type}</type></note>`
}

function measure(number, inner, { first = false, implicit = false, divisions = 4, bpm = 120 } = {}) {
  const attrs = first
    ? F.attributes({ divisions }) + F.soundTempo(bpm)
    : ''
  const implicitAttr = implicit ? ' implicit="yes"' : ''
  return `<measure number="${number}"${implicitAttr}>${attrs}${inner}</measure>`
}

function score(measuresXml, { divisions } = {}) {
  void divisions
  return F.scoreWrap(`<part id="P1">${measuresXml.join('')}</part>`)
}

function fourQuarters(steps = ['C', 'D', 'E', 'F'], options = {}) {
  return steps.map((step) => pitchXml({ step, ...options })).join('')
}

const tieStart =
  '<tie type="start"/><notations><tied type="start"/></notations>'
const slurStart = '<notations><slur type="start" number="1"/></notations>'
const staccato = '<notations><articulations><staccato/></articulations></notations>'

function codes(report) {
  return report.measures.flatMap((m) => m.defects.map((d) => d.code))
}

function countCode(report, code) {
  const fromTop = report.topDefects.find((entry) => entry.code === code)?.count
  if (fromTop != null) {
    return fromTop
  }
  return report.measures
    .flatMap((measure) => measure.defects)
    .filter((defect) => defect.code === code).length
}

describe('semantic evaluator hardening', () => {
  it('documents musical-unit tolerances', () => {
    expect(SEMANTIC_EVAL_TOLERANCES.onsetToleranceQuarters).toBe(0.125)
    expect(SEMANTIC_EVAL_TOLERANCES.durationToleranceQuarters).toBe(0.125)
    expect(SEMANTIC_EVAL_TOLERANCES.tempoToleranceBpm).toBe(2)
    expect(SEMANTIC_EVAL_TOLERANCES.quarterEpsilon).toBeLessThan(1e-3)
  })

  it('self-compares identical MusicXML with zero defects and full coverage', () => {
    const xml = score([
      measure(1, fourQuarters(), { first: true }),
      measure(2, fourQuarters(['G', 'A', 'B', 'C'])),
    ])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: xml,
      generatedMusicXml: xml,
    })
    const check = assertSemanticSelfCheck(report)
    expect(check.ok).toBe(true)
    expect(report.schemaVersion).toBe(SEMANTIC_EVAL_SCHEMA_VERSION)
    expect(report.evaluatorVersion).toBe(SEMANTIC_EVALUATOR_VERSION)
    expect(report.totals.defectCount).toBe(0)
    expect(report.classes.pitch.coverage).toBe(1)
    expect(report.classes.pitch.numerator).toBe(report.classes.pitch.denominator)
  })

  it('treats different divisions / voice numbering as equivalent', () => {
    const a = score([
      measure(1, fourQuarters(['C', 'D', 'E', 'F'], { voice: 1 }), {
        first: true,
        divisions: 4,
      }),
    ])
    const b = score([
      measure(
        1,
        [
          pitchXml({ step: 'C', duration: 8, voice: 5, type: 'quarter' }),
          pitchXml({ step: 'D', duration: 8, voice: 5, type: 'quarter' }),
          pitchXml({ step: 'E', duration: 8, voice: 5, type: 'quarter' }),
          pitchXml({ step: 'F', duration: 8, voice: 5, type: 'quarter' }),
        ].join(''),
        { first: true, divisions: 8 },
      ),
    ])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: a,
      generatedMusicXml: b,
      options: { mode: 'written' },
    })
    expect(report.totals.defectCount).toBe(0)
    expect(report.classes.pitch.score).toBe(1)
    expect(report.classes.rhythm.score).toBe(1)
  })

  it('golden: one wrong pitch', () => {
    const truth = score([measure(1, fourQuarters(), { first: true })])
    const generated = score([
      measure(1, fourQuarters(['C', 'D', 'E', 'G']), { first: true }),
    ])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    expect(countCode(report, SEMANTIC_DEFECT_CODE.INCORRECT_PITCH)).toBe(1)
    expect(report.classes.pitch.falseNegatives).toBe(1)
    expect(report.classes.pitch.denominator).toBe(4)
    expect(report.classes.pitch.numerator).toBe(3)
    expect(report.classes.pitch.score).toBe(0.75)
    // Error independence: wrong pitch must not invent missing-note / duration defects
    expect(countCode(report, SEMANTIC_DEFECT_CODE.MISSING_NOTE)).toBe(0)
    expect(countCode(report, SEMANTIC_DEFECT_CODE.DURATION_MISMATCH)).toBe(0)
  })

  it('golden: one missing note', () => {
    const truth = score([measure(1, fourQuarters(), { first: true })])
    const generated = score([
      measure(
        1,
        [
          pitchXml({ step: 'C' }),
          pitchXml({ step: 'D' }),
          pitchXml({ step: 'E' }),
          restXml({ duration: 4 }),
        ].join(''),
        { first: true },
      ),
    ])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    expect(countCode(report, SEMANTIC_DEFECT_CODE.MISSING_NOTE)).toBe(1)
    expect(report.classes.pitch.falseNegatives).toBe(1)
    // Missing note must not also charge articulation/tie/duration on that note
    expect(report.classes.sustain.falseNegatives).toBe(0)
    expect(report.classes.articulation.falseNegatives).toBe(0)
  })

  it('golden: quarter vs eighth', () => {
    const truth = score([
      measure(
        1,
        [
          pitchXml({ step: 'C', duration: 4, type: 'quarter' }),
          pitchXml({ step: 'D', duration: 4, type: 'quarter' }),
          pitchXml({ step: 'E', duration: 4, type: 'quarter' }),
          pitchXml({ step: 'F', duration: 4, type: 'quarter' }),
        ].join(''),
        { first: true },
      ),
    ])
    const generated = score([
      measure(
        1,
        [
          pitchXml({ step: 'C', duration: 4, type: 'quarter' }),
          pitchXml({ step: 'D', duration: 2, type: 'eighth' }),
          restXml({ duration: 2, type: 'eighth' }),
          pitchXml({ step: 'E', duration: 4, type: 'quarter' }),
          pitchXml({ step: 'F', duration: 4, type: 'quarter' }),
        ].join(''),
        { first: true },
      ),
    ])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    expect(countCode(report, SEMANTIC_DEFECT_CODE.DURATION_MISMATCH)).toBe(1)
    expect(report.classes.rhythm.falseNegatives).toBeGreaterThanOrEqual(1)
  })

  it('golden: missing dot', () => {
    const truth = score([
      measure(
        1,
        [
          pitchXml({ step: 'C', duration: 6, type: 'quarter', dots: 1 }),
          pitchXml({ step: 'D', duration: 2, type: 'eighth' }),
          pitchXml({ step: 'E', duration: 4 }),
          pitchXml({ step: 'F', duration: 4 }),
        ].join(''),
        { first: true },
      ),
    ])
    const generated = score([
      measure(
        1,
        [
          pitchXml({ step: 'C', duration: 4, type: 'quarter', dots: 0 }),
          pitchXml({ step: 'D', duration: 4, type: 'quarter' }),
          pitchXml({ step: 'E', duration: 4 }),
          pitchXml({ step: 'F', duration: 4 }),
        ].join(''),
        { first: true },
      ),
    ])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    expect(codes(report)).toContain(SEMANTIC_DEFECT_CODE.MISSING_DOT)
  })

  it('golden: missing rest', () => {
    const truth = score([
      measure(
        1,
        [
          pitchXml({ step: 'C' }),
          restXml({ duration: 4 }),
          pitchXml({ step: 'E' }),
          pitchXml({ step: 'F' }),
        ].join(''),
        { first: true },
      ),
    ])
    const generated = score([
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
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    expect(countCode(report, SEMANTIC_DEFECT_CODE.MISSING_REST)).toBe(1)
  })

  it('golden: missing tie', () => {
    const truth = score([
      measure(
        1,
        [
          pitchXml({ step: 'C', duration: 8, type: 'half', notations: tieStart }),
          pitchXml({ step: 'D', duration: 4 }),
          pitchXml({ step: 'E', duration: 4 }),
        ].join(''),
        { first: true },
      ),
    ])
    const generated = score([
      measure(
        1,
        [
          pitchXml({ step: 'C', duration: 8, type: 'half' }),
          pitchXml({ step: 'D', duration: 4 }),
          pitchXml({ step: 'E', duration: 4 }),
        ].join(''),
        { first: true },
      ),
    ])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    expect(countCode(report, SEMANTIC_DEFECT_CODE.MISSING_TIE)).toBe(1)
    expect(report.classes.sustain.denominator).toBe(1)
    expect(report.classes.sustain.score).toBe(0)
  })

  it('golden: tie mistaken for slur', () => {
    const truth = score([
      measure(
        1,
        [
          pitchXml({ step: 'C', duration: 8, type: 'half', notations: tieStart }),
          pitchXml({ step: 'D', duration: 4 }),
          pitchXml({ step: 'E', duration: 4 }),
        ].join(''),
        { first: true },
      ),
    ])
    const generated = score([
      measure(
        1,
        [
          pitchXml({ step: 'C', duration: 8, type: 'half', notations: slurStart }),
          pitchXml({ step: 'D', duration: 4 }),
          pitchXml({ step: 'E', duration: 4 }),
        ].join(''),
        { first: true },
      ),
    ])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    expect(countCode(report, SEMANTIC_DEFECT_CODE.TIE_VS_SLUR)).toBe(1)
  })

  it('golden: missing staccato', () => {
    const truth = score([
      measure(
        1,
        [
          pitchXml({ step: 'C', notations: staccato }),
          pitchXml({ step: 'D' }),
          pitchXml({ step: 'E' }),
          pitchXml({ step: 'F' }),
        ].join(''),
        { first: true },
      ),
    ])
    const generated = score([measure(1, fourQuarters(), { first: true })])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    expect(countCode(report, SEMANTIC_DEFECT_CODE.MISSING_STACCATO)).toBe(1)
    expect(report.classes.articulation.denominator).toBe(1)
    expect(report.classes.articulation.score).toBe(0)
  })

  it('golden: wrong voice (collapsed lanes)', () => {
    const truth = score([
      measure(
        1,
        [
          pitchXml({ step: 'C', voice: 1 }),
          pitchXml({ step: 'E', voice: 2 }),
          pitchXml({ step: 'G', voice: 1 }),
          pitchXml({ step: 'B', voice: 2 }),
        ].join(''),
        { first: true },
      ),
    ])
    const generated = score([
      measure(
        1,
        [
          pitchXml({ step: 'C', voice: 1 }),
          pitchXml({ step: 'E', voice: 1 }),
          pitchXml({ step: 'G', voice: 1 }),
          pitchXml({ step: 'B', voice: 1 }),
        ].join(''),
        { first: true },
      ),
    ])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    expect(codes(report)).toContain(SEMANTIC_DEFECT_CODE.VOICE_MISMATCH)
  })

  it('golden: missing measure + alignment confidence', () => {
    const truth = score([
      measure(1, fourQuarters(['C', 'D', 'E', 'F']), { first: true }),
      measure(2, fourQuarters(['C', 'C', 'C', 'C'])),
      measure(3, fourQuarters(['G', 'G', 'G', 'G'])),
      measure(4, fourQuarters(['A', 'A', 'A', 'A'])),
    ])
    // Distinct middle content removed so alignment cannot quietly merge it away.
    const generated = score([
      measure(1, fourQuarters(['C', 'D', 'E', 'F']), { first: true }),
      measure(2, fourQuarters(['G', 'G', 'G', 'G'])),
      measure(3, fourQuarters(['A', 'A', 'A', 'A'])),
    ])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    const alignKinds = report.alignment.pairs.map((pair) => pair.kind)
    expect(
      alignKinds.includes('missing') ||
        alignKinds.includes('merge') ||
        codes(report).includes(SEMANTIC_DEFECT_CODE.MISSING_MEASURE) ||
        codes(report).includes(SEMANTIC_DEFECT_CODE.MERGED_MEASURE),
    ).toBe(true)
    expect(report.alignment.confidence).toBeLessThan(1)
    expect(report.firstDivergence).not.toBeNull()
    expect(report.totals.truthMeasureCount).toBe(4)
    expect(report.totals.generatedMeasureCount).toBe(3)
  })

  it('golden: pickup measure alignment', () => {
    const truth = score([
      measure(1, pitchXml({ step: 'B', duration: 4 }), { first: true, implicit: true }),
      measure(2, fourQuarters(['C', 'D', 'E', 'F'])),
      measure(3, fourQuarters(['G', 'A', 'B', 'C'])),
    ])
    const generated = score([
      measure(1, fourQuarters(['C', 'D', 'E', 'F']), { first: true }),
      measure(2, fourQuarters(['G', 'A', 'B', 'C'])),
    ])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    // Full bars should still pair; pickup is missing/extra/unmatched.
    expect(report.alignment.matchedCount).toBeGreaterThanOrEqual(2)
    const kinds = report.alignment.pairs.map((pair) => pair.kind)
    expect(kinds.some((kind) => kind === 'missing' || kind === 'extra' || kind === 'merge')).toBe(
      true,
    )
    expect(report.alignment.confidence).toBeLessThan(1)
  })

  it('golden: repeat/volta difference stays in interpretation (written mode)', () => {
    const truthXml = F.scoreWrap(`<part id="P1">
      <measure number="1">${F.attributes({ divisions: 4 })}${F.soundTempo(120)}
        <barline location="left"><repeat direction="forward"/></barline>
        ${fourQuarters()}
      </measure>
      <measure number="2">
        ${fourQuarters(['G', 'A', 'B', 'C'])}
        <barline location="right"><repeat direction="backward"/></barline>
      </measure>
    </part>`)
    const generatedXml = score([
      measure(1, fourQuarters(), { first: true }),
      measure(2, fourQuarters(['G', 'A', 'B', 'C'])),
    ])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truthXml,
      generatedMusicXml: generatedXml,
      options: { mode: 'written' },
    })
    expect(countCode(report, SEMANTIC_DEFECT_CODE.REPEAT_MISMATCH)).toBeGreaterThanOrEqual(1)
    // Written note comparison should still match pitches
    expect(report.classes.pitch.score).toBe(1)
  })

  it('golden: tempo difference', () => {
    const truth = score([measure(1, fourQuarters(), { first: true, bpm: 120 })])
    const generated = score([measure(1, fourQuarters(), { first: true, bpm: 90 })])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    expect(countCode(report, SEMANTIC_DEFECT_CODE.TEMPO_MISMATCH)).toBe(1)
    expect(report.classes.interpretation.score).toBeLessThan(1)
  })

  it('golden: chord with one missing note (no cascade)', () => {
    const truth = score([
      measure(
        1,
        [
          pitchXml({ step: 'C' }),
          pitchXml({ step: 'E', chord: true }),
          pitchXml({ step: 'G', chord: true }),
          pitchXml({ step: 'D' }),
          pitchXml({ step: 'E' }),
          pitchXml({ step: 'F' }),
        ].join(''),
        { first: true },
      ),
    ])
    const generated = score([
      measure(
        1,
        [
          pitchXml({ step: 'C' }),
          pitchXml({ step: 'E', chord: true }),
          pitchXml({ step: 'D' }),
          pitchXml({ step: 'E' }),
          pitchXml({ step: 'F' }),
        ].join(''),
        { first: true },
      ),
    ])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    expect(countCode(report, SEMANTIC_DEFECT_CODE.MISSING_NOTE)).toBe(1)
    expect(report.classes.pitch.falseNegatives).toBe(1)
    expect(report.classes.pitch.falsePositives).toBe(0)
  })

  it('does not cross-match staff 1 against staff 2', () => {
    const truthNotes = [
      {
        midi: 60,
        onsetQuarters: 0,
        durationQuarters: 1,
        voice: 1,
        staff: 1,
        isRest: false,
      },
    ]
    const generatedNotes = [
      {
        midi: 60,
        onsetQuarters: 0,
        durationQuarters: 1,
        voice: 1,
        staff: 2,
        isRest: false,
      },
    ]
    const matched = matchSemanticEvents(truthNotes, generatedNotes)
    expect(matched.matches).toHaveLength(0)
    expect(matched.missing).toHaveLength(1)
    expect(matched.extra).toHaveLength(1)
  })

  it('canonicalizes equivalent voice numbering', () => {
    const notes = canonicalizeVoices([
      { voice: 5, staff: 1, onsetQuarters: 0, midi: 60, isRest: false, durationQuarters: 1 },
      { voice: 6, staff: 1, onsetQuarters: 0, midi: 64, isRest: false, durationQuarters: 1 },
    ])
    expect(new Set(notes.map((n) => n.voice)).size).toBe(2)
    expect(Math.min(...notes.map((n) => n.voice))).toBe(1)
  })

  it('written mode ignores performed timeline expansion differences', () => {
    const withRepeat = F.scoreWrap(`<part id="P1">
      <measure number="1">${F.attributes({ divisions: 4 })}${F.soundTempo(120)}
        <barline location="left"><repeat direction="forward"/></barline>
        ${fourQuarters()}
      </measure>
      <measure number="2">
        ${fourQuarters(['G', 'A', 'B', 'C'])}
        <barline location="right"><repeat direction="backward"/></barline>
      </measure>
    </part>`)
    const writtenOnly = score([
      measure(1, fourQuarters(), { first: true }),
      measure(2, fourQuarters(['G', 'A', 'B', 'C'])),
    ])
    const writtenReport = evaluateSemanticMusicXml({
      groundTruthMusicXml: withRepeat,
      generatedMusicXml: writtenOnly,
      options: { mode: 'written' },
    })
    const performedReport = evaluateSemanticMusicXml({
      groundTruthMusicXml: withRepeat,
      generatedMusicXml: writtenOnly,
      options: { mode: 'performed' },
    })
    expect(writtenReport.classes.pitch.score).toBe(1)
    expect(writtenReport.classes.playback.ignored).toBeGreaterThan(0)
    expect(performedReport.classes.playback.denominator).toBeGreaterThan(0)
  })

  it('marks low-coverage classes as unreliable in display', () => {
    const truth = score([measure(1, fourQuarters(), { first: true })])
    const generated = score([measure(1, fourQuarters(), { first: true })])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    // No ties in score → sustain presentInTruth 0 → reliable with score 1
    expect(report.classes.sustain.presentInTruth).toBe(0)
    expect(report.classes.sustain.reliable).toBe(true)
    expect(report.classes.sustain.score).toBe(1)
  })

  it('exposes worst measures, compact summary, and alignment fingerprints', () => {
    const truth = score([
      measure(1, fourQuarters(), { first: true }),
      measure(2, [
        pitchXml({ step: 'C', notations: staccato }),
        pitchXml({ step: 'D' }),
        pitchXml({ step: 'E' }),
        pitchXml({ step: 'F' }),
      ].join('')),
    ])
    const generated = score([
      measure(1, fourQuarters(['C', 'D', 'E', 'G']), { first: true }),
      measure(2, fourQuarters()),
    ])
    const report = evaluateSemanticMusicXml({
      groundTruthMusicXml: truth,
      generatedMusicXml: generated,
      options: { mode: 'written' },
    })
    expect(report.worstMeasures.length).toBeGreaterThan(0)
    expect(report.topDefectClasses.length).toBeGreaterThan(0)
    expect(formatCompactSummary(report)).toMatch(/^semantic /)

    const fp = buildMeasureFingerprint(
      { number: 1, lengthQuarters: 4, notatedLengthQuarters: 4, implicit: false },
      [{ midi: 60, onsetQuarters: 0, isRest: false, voice: 1, staff: 1 }],
    )
    const aligned = alignMeasureSequences([fp], [fp])
    expect(aligned.confidence).toBe(1)
    expect(aligned.pairs[0].kind).toBe('match')
  })

  it('CLI self-check and equivalent-check pass', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omr-semantic-hard-'))
    const xml = score([measure(1, fourQuarters(), { first: true })])
    const pathA = join(dir, 'a.musicxml')
    const pathB = join(dir, 'b.musicxml')
    const jsonPath = join(dir, 'report.json')
    writeFileSync(pathA, xml)
    // equivalent encoding: divisions 8, voice 5
    writeFileSync(
      pathB,
      score([
        measure(
          1,
          [
            pitchXml({ step: 'C', duration: 8, voice: 5 }),
            pitchXml({ step: 'D', duration: 8, voice: 5 }),
            pitchXml({ step: 'E', duration: 8, voice: 5 }),
            pitchXml({ step: 'F', duration: 8, voice: 5 }),
          ].join(''),
          { first: true, divisions: 8 },
        ),
      ]),
    )

    execFileSync('node', [
      'scripts/evaluate-omr-semantic.mjs',
      '--self-check',
      pathA,
      '--mode',
      'written',
      '--compact',
    ])
    execFileSync('node', [
      'scripts/evaluate-omr-semantic.mjs',
      '--equivalent',
      pathA,
      pathB,
      '--mode',
      'written',
      '--json',
      jsonPath,
    ])
    expect(existsSync(jsonPath)).toBe(true)
    const report = JSON.parse(readFileSync(jsonPath, 'utf8'))
    expect(report.schemaVersion).toBe(2)
    expect(report.totals.defectCount).toBe(0)
  })
})
