import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  replayMicV3PerformanceSequence,
  summarizeMicV3PerformanceSequences,
} from '../src/features/microphone-input/v3/performanceSequenceReplay.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(
  join(root, 'benchmarks/mic-performance-sequences/manifest.json'),
  'utf8',
))

describe('Mic V3 musical sequence replay corpus', () => {
  it('passes double-stop, quorum, rolled, repeated, ringing, wrong, and speech cases', () => {
    const results = manifest.scenarios.map(replayMicV3PerformanceSequence)
    const summary = summarizeMicV3PerformanceSequences(results)

    expect(summary.scenarioCount).toBeGreaterThanOrEqual(8)
    expect(summary.passedScenarios).toBe(summary.scenarioCount)
    expect(summary.passedCheckpoints).toBe(summary.checkpointCount)
    expect(summary.falseAdvanceCount).toBe(0)
    expect(summary.ringingTransitionSuccess).toEqual({
      count: 1,
      successes: 1,
      successRate: 1,
    })
  })

  it('labels every scenario as synthetic IR rather than a real performance', () => {
    for (const scenario of manifest.scenarios) {
      expect(scenario.provenance.fixtureClass).toBe('deterministic-ir-sequence')
      expect(scenario.provenance.naturalPerformance).toBe(false)
    }
  })
})
