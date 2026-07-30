/**
 * Timing-map cache: validate + practice parse share one parse per content hash.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clearTimingMapCache,
  clearPracticePrepMarks,
  getCachedTimingMap,
  getOrParseTimingMap,
  getPracticePrepMarks,
  __timingMapCacheSizeForTests,
} from '../src/features/musicxml/timingMapCache.js'
import { validateOmrGeneratedPlayback } from '../src/features/omr/validateOmrGeneratedPlayback.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const smallXml = readFileSync(
  join(root, 'benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.musicxml'),
  'utf8',
)

describe('timingMapCache', () => {
  beforeEach(() => {
    clearTimingMapCache()
    clearPracticePrepMarks()
  })

  it('parses once per content hash and returns cache hits afterwards', () => {
    const first = getOrParseTimingMap(smallXml, 'small.musicxml')
    expect(first.fromCache).toBe(false)
    expect(first.timingMap?.notes?.length ?? 0).toBeGreaterThan(0)
    expect(__timingMapCacheSizeForTests()).toBe(1)

    const second = getOrParseTimingMap(smallXml, 'small.musicxml')
    expect(second.fromCache).toBe(true)
    expect(second.timingMap).toBe(first.timingMap)
    expect(second.durationMs).toBeLessThan(first.durationMs + 5)
  })

  it('validateOmrGeneratedPlayback seeds the cache for Practice reuse', () => {
    const validation = validateOmrGeneratedPlayback(smallXml, 'seed.omr.musicxml')
    expect(validation.ok).toBe(true)
    expect(validation.timingMap).toBeTruthy()
    expect(validation.contentHash).toBeTruthy()

    const cached = getCachedTimingMap(validation.contentHash)
    expect(cached).toBe(validation.timingMap)

    const reuse = getOrParseTimingMap(smallXml, 'seed.omr.musicxml', {
      contentHash: validation.contentHash,
    })
    expect(reuse.fromCache).toBe(true)
    expect(reuse.timingMap).toBe(validation.timingMap)
  })

  it('records practice prep marks for relative budgets', () => {
    getOrParseTimingMap(smallXml, 'mark.musicxml')
    const marks = getPracticePrepMarks()
    expect(marks.some((entry) => entry.stage === 'timing-parse')).toBe(true)
  })
})
