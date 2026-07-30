/**
 * Relative practice-prep budgets for small / medium / dense MusicXML.
 * Absolute CI milliseconds are too flaky; we assert cache reuse and that
 * dense parses stay within a multiple of the small-score baseline in-process.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clearPracticePrepMarks,
  clearTimingMapCache,
  getOrParseTimingMap,
} from '../src/features/musicxml/timingMapCache.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readFixture(...parts) {
  const path = join(root, ...parts)
  if (!existsSync(path)) {
    return null
  }
  return readFileSync(path, 'utf8')
}

const smallXml = readFixture(
  'benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.musicxml',
)
const mediumXml = readFixture(
  'benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.musicxml',
)
const denseXml =
  readFixture('tmp/omr-quality-campaign/baseline/generated/la-campanella.musicxml') ||
  readFixture(
    'benchmarks/omr-fixtures/piano-dense-advanced-vector/piano-dense-advanced-vector.musicxml',
  )

describe('practice preparation relative budgets', () => {
  beforeEach(() => {
    clearTimingMapCache()
    clearPracticePrepMarks()
  })

  it('small score parses and cache-hits faster than the cold parse', () => {
    expect(smallXml).toBeTruthy()
    const cold = getOrParseTimingMap(smallXml, 'small.musicxml')
    const hot = getOrParseTimingMap(smallXml, 'small.musicxml')
    expect(hot.fromCache).toBe(true)
    expect(hot.durationMs).toBeLessThanOrEqual(Math.max(2, cold.durationMs * 0.5))
  })

  it('Evangelion-scale / grand-voices parse stays within a relative multiple of small', () => {
    expect(smallXml).toBeTruthy()
    expect(mediumXml).toBeTruthy()
    const small = getOrParseTimingMap(smallXml, 'small.musicxml')
    clearTimingMapCache()
    const medium = getOrParseTimingMap(mediumXml, 'medium.musicxml')
    // Relative budget: medium may be heavier, but not orders of magnitude in
    // this environment without also being a correctness failure elsewhere.
    const ratio = medium.durationMs / Math.max(1, small.durationMs)
    expect(ratio).toBeLessThan(80)
    expect(medium.timingMap.measures?.length ?? 0).toBeGreaterThan(0)
  })

  it('La Campanella / dense parse + deferred visual groups stay bounded vs small', () => {
    expect(smallXml).toBeTruthy()
    expect(denseXml).toBeTruthy()
    const small = getOrParseTimingMap(smallXml, 'small.musicxml')
    clearTimingMapCache()
    const dense = getOrParseTimingMap(denseXml, 'dense.musicxml')
    const ratio = dense.durationMs / Math.max(1, small.durationMs)
    expect(ratio).toBeLessThan(200)

    const t0 = performance.now()
    const groups = buildVisualLaneGroups(dense.timingMap, null, {
      instrumentId: 'piano',
    })
    const buildMs = performance.now() - t0
    expect(groups.length).toBeGreaterThan(0)

    const t1 = performance.now()
    const cached = buildVisualLaneGroups(dense.timingMap, null, {
      instrumentId: 'piano',
    })
    const cachedMs = performance.now() - t1
    expect(cached).toBe(groups)
    expect(cachedMs).toBeLessThanOrEqual(Math.max(2, buildMs * 0.5))
  })
})
