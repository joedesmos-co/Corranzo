/**
 * Phase 1 tests — confidence→action policy + exportable alignment report.
 */
import { describe, expect, it } from 'vitest'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { reconcilePdfLayoutWithScore } from '../src/features/score-follow/alignmentReconciliation.js'
import { LAYOUT_CONFIDENCE } from '../src/features/score-follow/layoutAssessment.js'
import {
  decideFollowAction,
  FOLLOW_ACTION,
} from '../src/features/score-follow/alignmentConfidencePolicy.js'
import {
  buildAlignmentReport,
  formatAlignmentReportText,
  formatModelSummary,
  serializeAlignmentReport,
} from '../src/features/score-follow/alignmentReport.js'
import { straight4, oneRepeat } from './helpers/buildXml.js'

const timingMap = parseMusicXml(straight4(), 'straight4')
const clean = reconcilePdfLayoutWithScore({ timingMap, perSystemBarlineCounts: [2, 2] })
const barlineMismatch = reconcilePdfLayoutWithScore({ timingMap, perSystemBarlineCounts: [3, 3] })
const weak = reconcilePdfLayoutWithScore({ timingMap, perSystemBarlineCounts: [8, 0] })

describe('decideFollowAction — three-tier ladder', () => {
  it('auto-follows on exact confidence with a clean layout', () => {
    expect(decideFollowAction({ layoutConfidence: LAYOUT_CONFIDENCE.EXACT, reconciliation: clean }).action).toBe(
      FOLLOW_ACTION.AUTO,
    )
  })

  it('auto-follows on good confidence when every system is confident', () => {
    expect(decideFollowAction({ layoutConfidence: LAYOUT_CONFIDENCE.GOOD, reconciliation: clean }).action).toBe(
      FOLLOW_ACTION.AUTO,
    )
  })

  it('asks for manual setup when layout confidence needs setup', () => {
    expect(
      decideFollowAction({ layoutConfidence: LAYOUT_CONFIDENCE.NEEDS_SETUP, reconciliation: clean }).action,
    ).toBe(FOLLOW_ACTION.MANUAL)
  })

  it('never auto-follows when the barline total disagrees (hard stop → manual)', () => {
    const decision = decideFollowAction({ layoutConfidence: LAYOUT_CONFIDENCE.EXACT, reconciliation: barlineMismatch })
    expect(decision.action).toBe(FOLLOW_ACTION.MANUAL)
    expect(decision.reasons.join(' ')).toMatch(/barline/i)
  })

  it('falls back to manual when a system is too weak', () => {
    expect(decideFollowAction({ layoutConfidence: LAYOUT_CONFIDENCE.GOOD, reconciliation: weak }).action).toBe(
      FOLLOW_ACTION.MANUAL,
    )
  })

  it('asks for a quick confirmation on approximate-but-clean layouts', () => {
    expect(
      decideFollowAction({ layoutConfidence: LAYOUT_CONFIDENCE.APPROXIMATE, reconciliation: clean }).action,
    ).toBe(FOLLOW_ACTION.CONFIRM)
  })
})

describe('buildAlignmentReport', () => {
  it('produces a structured, exportable report', () => {
    const report = buildAlignmentReport({
      reconciliation: clean,
      timingMap,
      layoutConfidence: LAYOUT_CONFIDENCE.EXACT,
      pieceId: 'straight4',
      generatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(report.version).toBe(1)
    expect(report.pieceId).toBe('straight4')
    expect(report.generatedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(report.decision.action).toBe(FOLLOW_ACTION.AUTO)
    expect(report.decision.label).toBeTruthy()
    expect(report.perSystem).toHaveLength(2)
    expect(report.totals.expectedMeasureCount).toBe(4)
    expect(Array.isArray(report.warnings)).toBe(true)
  })

  it('surfaces a warning when the barline total mismatches', () => {
    const report = buildAlignmentReport({
      reconciliation: barlineMismatch,
      timingMap,
      layoutConfidence: LAYOUT_CONFIDENCE.GOOD,
    })
    expect(report.warnings.some((w) => /barline/i.test(w))).toBe(true)
    expect(report.decision.action).toBe(FOLLOW_ACTION.MANUAL)
  })

  it('renders a fixed-width text table with warnings', () => {
    const report = buildAlignmentReport({
      reconciliation: weak,
      timingMap,
      layoutConfidence: LAYOUT_CONFIDENCE.APPROXIMATE,
    })
    const text = formatAlignmentReportText(report)
    expect(text).toMatch(/System\s+Page\s+Detected\s+Expected/)
    expect(text).toMatch(/Recommended action:/)
    expect(text).toMatch(/Warnings:/)
  })

  it('serializes to valid JSON that round-trips', () => {
    const report = buildAlignmentReport({
      reconciliation: clean,
      timingMap,
      layoutConfidence: LAYOUT_CONFIDENCE.EXACT,
      generatedAt: '2026-01-01T00:00:00.000Z',
    })
    const parsed = JSON.parse(serializeAlignmentReport(report))
    expect(parsed.version).toBe(1)
    expect(parsed.perSystem).toHaveLength(2)
    expect(parsed.decision.action).toBe(FOLLOW_ACTION.AUTO)
  })
})

describe('Phase 2: concise model summary', () => {
  const repeatRecon = reconcilePdfLayoutWithScore({
    timingMap: parseMusicXml(oneRepeat(), 'oneRepeat'),
    perSystemBarlineCounts: [4],
  })

  it('emits the five honest model lines', () => {
    const report = buildAlignmentReport({ reconciliation: clean, layoutConfidence: LAYOUT_CONFIDENCE.EXACT })
    const lines = formatModelSummary(report)
    expect(lines).toHaveLength(5)
    expect(lines[0]).toBe('Pickup: no')
    expect(lines[1]).toBe('Repeats/voltas: no')
    expect(lines[2]).toBe('Tempo changes: 0')
    expect(lines[3]).toBe('Time-signature changes: 0')
    expect(lines[4]).toBe('Page/system: aligned')
  })

  it('describes repeats with performed-vs-written and revisited measures', () => {
    const report = buildAlignmentReport({ reconciliation: repeatRecon, layoutConfidence: LAYOUT_CONFIDENCE.GOOD })
    const repeatsLine = formatModelSummary(report).find((l) => l.startsWith('Repeats/voltas:'))
    expect(repeatsLine).toMatch(/yes/)
    expect(repeatsLine).toMatch(/performed 6 vs written 4/)
    expect(repeatsLine).toMatch(/m1, m2/)
  })

  it('includes the Model block in the rendered text report', () => {
    const report = buildAlignmentReport({ reconciliation: clean, layoutConfidence: LAYOUT_CONFIDENCE.EXACT })
    const text = formatAlignmentReportText(report)
    expect(text).toMatch(/Model:/)
    expect(text).toMatch(/Pickup:/)
    expect(text).toMatch(/Repeats\/voltas:/)
    expect(text).toMatch(/Tempo changes:/)
    expect(text).toMatch(/Time-signature changes:/)
    expect(text).toMatch(/Page\/system:/)
  })
})
