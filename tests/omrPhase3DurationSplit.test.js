/**
 * OMR Engine V2 Phase 3 — written vs sounding duration IR + diagnostics.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildScoreGraph, summarizeScoreGraph } from '../src/features/omr/scoreGraph.js'
import {
  DURATION_SOURCE,
  observeNoteheadDuration,
  RELEASE_SOURCE,
  TIE_SUSTAIN_SOURCE,
  traceTieChainsInMeasure,
} from '../src/features/omr/scoreGraphDurationObservation.js'
import {
  buildWrittenSoundingDurationDiagnostics,
  classifyWrittenSoundingDurationError,
  WRITTEN_SOUNDING_DURATION_CLASS,
} from '../src/features/omr/omrWrittenSoundingDurationDiagnostics.js'
import { extractFixtureMetrics } from '../src/features/omr/omrBenchmarkDashboard.js'

const denseFixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tmp/omr-benchmark-dashboard/fixtures/dense.json'), 'utf8'),
)

function samplePages() {
  const events = [
    {
      type: 'note',
      startDivision: 0,
      durationDivisions: 4,
      notes: [{ midi: 60, clef: 'treble' }],
    },
    {
      type: 'note',
      startDivision: 4,
      durationDivisions: 4,
      notes: [{ midi: 62, clef: 'treble', tieStart: true }],
    },
    {
      type: 'note',
      startDivision: 8,
      durationDivisions: 4,
      notes: [{ midi: 62, clef: 'treble', tieStop: true }],
    },
  ]
  return [
    {
      page: 1,
      systems: [
        {
          systemIndex: 0,
          measures: [{ measureNumber: 1, page: 1, systemIndex: 0, events }],
        },
      ],
    },
  ]
}

describe('OMR V2 Phase 3 duration split', () => {
  it('does not mutate runtime page events when building ScoreGraph IR', () => {
    const pages = samplePages()
    const before = JSON.stringify(pages)
    buildScoreGraph(pages)
    expect(JSON.stringify(pages)).toBe(before)
  })

  it('populates written/sounding duration fields on ScoreGraph nodes', () => {
    const graph = buildScoreGraph(samplePages())
    const noteheads = graph.measures[0].nodes.filter((node) => node.kind === 'notehead')
    expect(noteheads[0].writtenDurationDivisions).toBe(4)
    expect(noteheads[0].soundingReleaseDivision).toBe(4)
    expect(noteheads[0].durationSource).toBe(DURATION_SOURCE.EVENT_NOTATION)
    expect(noteheads[1].tieSustainSource).toBe(TIE_SUSTAIN_SOURCE.TIE_START)
    expect(noteheads[1].soundingReleaseDivision).toBeGreaterThan(8)
    expect(noteheads[1].releaseSource).toBe(RELEASE_SOURCE.TIE_SUSTAIN)
    const summary = summarizeScoreGraph(graph)
    expect(summary.durationObservation.tieNodes).toBeGreaterThan(0)
  })

  it('observes gap-to-next-onset duration source without changing event bytes', () => {
    const events = [
      {
        type: 'note',
        startDivision: 0,
        durationDivisions: 5,
        notes: [{ midi: 48, clef: 'bass' }],
      },
      {
        type: 'note',
        startDivision: 5,
        durationDivisions: 4,
        notes: [{ midi: 50, clef: 'bass' }],
      },
    ]
    const before = JSON.stringify(events)
    const obs = observeNoteheadDuration({
      note: events[0].notes[0],
      event: events[0],
      events,
      totalDivisions: 16,
    })
    expect(JSON.stringify(events)).toBe(before)
    expect(obs.durationSource).toBe(DURATION_SOURCE.GAP_TO_NEXT_ONSET)
    expect(obs.gapToNextOnset).toBe(5)
  })

  it('classifies dense duration errors into written vs sounding buckets', () => {
    const diagnostics = buildWrittenSoundingDurationDiagnostics(denseFixture, {
      fixtureId: 'dense',
    })
    expect(diagnostics.phase).toBe(3)
    expect(diagnostics.writtenSoundingHistogram[WRITTEN_SOUNDING_DURATION_CLASS.ONSET_COUPLED_DURATION]).toBeGreaterThan(
      0,
    )
    expect(diagnostics.hotspotTraces.map((entry) => entry.measureNumber)).toEqual(
      expect.arrayContaining([7, 9, 121]),
    )
    expect(classifyWrittenSoundingDurationError({
      onsetDiffQuarters: 0.5,
      pitchDeltaSemitones: 0,
      truth: { durationQuarters: 1 },
      generated: { durationQuarters: 0.5 },
    })).toBe(WRITTEN_SOUNDING_DURATION_CLASS.ONSET_COUPLED_DURATION)
  })

  it('traces tie chains for observation without runtime changes', () => {
    const events = samplePages()[0].systems[0].measures[0].events
    const chains = traceTieChainsInMeasure(events, { measureNumber: 1 })
    expect(chains.length).toBeGreaterThan(0)
    expect(chains[0].segmentCount).toBeGreaterThanOrEqual(2)
  })

  it('keeps frozen dense benchmark runtime metrics unchanged', () => {
    const metrics = extractFixtureMetrics(denseFixture)
    expect(metrics.wrongOnset).toBe(94)
    expect(metrics.wrongDuration).toBe(77)
    expect(metrics.chordMismatch).toBe(172)
    expect(metrics.wrongPitch).toBe(147)
  })
})
