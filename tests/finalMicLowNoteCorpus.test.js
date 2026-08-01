import { beforeAll, describe, expect, it } from 'vitest'
import {
  FINAL_MIC_FIXTURES,
  FINAL_MIC_VARIANTS,
  runFinalMicCorpus,
} from '../scripts/lib/finalMicReleaseCorpus.mjs'

let corpus

beforeAll(() => {
  corpus = runFinalMicCorpus()
})

function runsFor(fixtureId) {
  return corpus.fixtures.filter((fixture) => fixture.fixtureId === fixtureId)
}

describe('final deterministic low-note microphone corpus', () => {
  it('covers all 20 required cases at multiple tempos and amplitudes', () => {
    expect(FINAL_MIC_FIXTURES).toHaveLength(20)
    expect(FINAL_MIC_VARIANTS.length).toBeGreaterThanOrEqual(2)
    expect(corpus.fixtures).toHaveLength(40)
    expect(corpus.configuration.sampleRate).toBe(44100)
    expect(corpus.configuration.frameSize).toBe(2048)
  })

  it('matches every intended score event with no false positive or false negative', () => {
    expect(corpus.summary.expectedAdvances).toBe(74)
    expect(corpus.summary.matchedAdvances).toBe(74)
    expect(corpus.summary.falseNegatives).toBe(0)
    expect(corpus.summary.falsePositives).toBe(0)
    expect(corpus.summary.passingRuns).toBe(corpus.configuration.runCount)
  })

  it('rearms repeated identical low notes without requiring pitch change or silence', () => {
    for (const fixtureId of [
      '03-same-low-over-decay',
      '10-fast-repeated-low',
      '20-no-silence-clear-attack',
    ]) {
      for (const run of runsFor(fixtureId)) {
        expect(run.matchedScoreEvents).toHaveLength(run.expectedAdvanceCount)
        expect(run.releaseRearmEvents.some((entry) => entry.reason === 'low-note-transient')).toBe(true)
      }
    }
  })

  it('does not double-trigger a sustained low note', () => {
    for (const run of runsFor('15-single-sustained-low')) {
      expect(run.expectedAdvanceCount).toBe(1)
      expect(run.matchedScoreEvents).toHaveLength(1)
      expect(run.falsePositives).toBe(0)
    }
  })

  it('recovers a weak fundamental while rejecting the wrong octave harmonic', () => {
    for (const run of runsFor('11-weak-fundamental-strong-h2')) {
      expect(run.matchedScoreEvents).toHaveLength(1)
      expect(run.matchedScoreEvents[0].expectedMidi).toBe(36)
    }
    for (const run of runsFor('18-wrong-octave-harmonic')) {
      expect(run.matchedScoreEvents).toHaveLength(0)
      expect(run.falsePositives).toBe(0)
    }
  })

  it('keeps middle/high transitions and neighboring low notes stable', () => {
    for (const fixtureId of [
      '04-neighboring-low-notes',
      '06-low-then-middle',
      '07-middle-then-low',
    ]) {
      for (const run of runsFor(fixtureId)) {
        expect(run.falseNegatives, run.id).toBe(0)
        expect(run.falsePositives, run.id).toBe(0)
      }
    }
  })

  it('keeps recognition latency within the measured acceptance budget', () => {
    expect(corpus.summary.medianLatencyMs).toBeLessThanOrEqual(100)
    expect(corpus.summary.maxLatencyMs).toBeLessThanOrEqual(300)
  })
})
