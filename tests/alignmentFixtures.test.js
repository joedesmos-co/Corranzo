/**
 * Phase 2b — golden reconciliation snapshots for the alignment fixture set.
 *
 * Runnable fixtures (bundled PD Minuet + synthetic MusicXML) run the real model
 * and are asserted against explicit golden snapshots. Metadata-only fixtures are
 * checked for being well-formed, license-documented, and never depending on a
 * non-redistributable asset being bundled.
 */
import { describe, expect, it } from 'vitest'
import { reconcilePdfLayoutWithScore } from '../src/features/score-follow/alignmentReconciliation.js'
import { buildAlignmentReport } from '../src/features/score-follow/alignmentReport.js'
import {
  RUNNABLE_FIXTURES,
  METADATA_FIXTURES,
  FOLLOW_ACTIONS,
} from './fixtures/alignmentFixtures.js'

const SNAPSHOT_KEYS = [
  'writtenMeasures',
  'pdfPageCount',
  'systemCount',
  'perSystemExpected',
  'systemStarts',
  'hasRepeats',
  'tempoChangeCount',
  'timeSignatureChangeCount',
  'hasPickup',
]

function systemStartsOf(reconciliation, timingMap) {
  const starts = []
  let measure = timingMap.measures[0]?.number ?? 1
  for (const system of reconciliation.perSystem) {
    starts.push(measure)
    measure += system.expectedMeasures
  }
  return starts
}

describe('Phase 2b: the full fixture set is catalogued', () => {
  it('covers all eight requested pieces', () => {
    const ids = [...RUNNABLE_FIXTURES, ...METADATA_FIXTURES].map((f) => f.id)
    for (const id of [
      'minuet-in-g',
      'gymnopedie-1',
      'guren',
      'carol',
      'turkish-march',
      'dense-fast',
      'multi-page',
      'repeats-voltas',
    ]) {
      expect(ids).toContain(id)
    }
  })
})

describe('Phase 2b: runnable fixtures match their golden snapshots', () => {
  for (const fixture of RUNNABLE_FIXTURES) {
    describe(fixture.id, () => {
      const inputs = fixture.makeInputs()
      const reconciliation = reconcilePdfLayoutWithScore(inputs)
      const report = buildAlignmentReport({
        reconciliation,
        timingMap: inputs.timingMap,
        layoutConfidence: inputs.layoutConfidence,
      })
      const golden = fixture.golden
      const perSystemExpected = reconciliation.perSystem.map((s) => s.expectedMeasures)

      it('matches measures, pages and system count', () => {
        expect(reconciliation.totals.expectedMeasureCount).toBe(golden.writtenMeasures)
        expect(inputs.pdfPageCount).toBe(golden.pdfPageCount)
        expect(reconciliation.totals.systemCount).toBe(golden.systemCount)
      })

      it('matches per-system measure counts and system starts', () => {
        expect(perSystemExpected).toEqual(golden.perSystemExpected)
        expect(systemStartsOf(reconciliation, inputs.timingMap)).toEqual(golden.systemStarts)
      })

      it('matches structural flags', () => {
        const f = reconciliation.flags
        expect(f.hasRepeats).toBe(golden.hasRepeats)
        expect(f.performedDiffersFromWritten).toBe(golden.performedDiffersFromWritten)
        expect(f.tempoChangeCount).toBe(golden.tempoChangeCount)
        expect(f.timeSignatureChangeCount).toBe(golden.timeSignatureChangeCount)
        expect(f.hasPickup).toBe(golden.hasPickup)
        expect(f.systemCountMismatch).toBe(golden.systemCountMismatch)
        if (golden.tempoChangeMeasures) {
          expect(f.tempoChangeMeasures).toEqual(golden.tempoChangeMeasures)
        }
      })

      it('classifies the expected follow action', () => {
        expect(report.decision.action).toBe(golden.action)
      })
    })
  }
})

describe('Phase 2b: metadata-only fixtures are documented and license-safe', () => {
  for (const fixture of METADATA_FIXTURES) {
    describe(fixture.id, () => {
      it('documents source, license and reason', () => {
        expect(fixture.title).toBeTruthy()
        expect(fixture.source).toBeTruthy()
        expect(fixture.license).toBeTruthy()
        expect(typeof fixture.redistributable).toBe('boolean')
        expect(fixture.bundled).toBe(false)
        expect((fixture.reason ?? '').length).toBeGreaterThan(20)
      })

      it('carries a documented snapshot with a valid expected action', () => {
        const documented = fixture.documented
        expect(documented).toBeTruthy()
        expect(FOLLOW_ACTIONS).toContain(documented.expectedAction)
        expect((documented.rationale ?? '').length).toBeGreaterThan(20)
        for (const key of SNAPSHOT_KEYS) {
          expect(documented).toHaveProperty(key)
        }
      })

      it('never bundles a non-redistributable asset', () => {
        if (!fixture.redistributable) {
          expect(fixture.bundled).toBe(false)
        }
      })
    })
  }
})
