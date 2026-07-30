/**
 * Shared MusicXML → timing-map cache keyed by content hash.
 *
 * validateOmrGeneratedPlayback and useMusicXmlTiming both need a full parse.
 * Without a cache, post-OMR Practice pays for the same sync parse twice (and
 * again under React Strict Mode). Entries are immutable score-owned maps.
 */

import { parseMusicXml } from './parseMusicXml.js'
import { contentIdentitySync } from '../library/scoreSourceContentIdentity.js'

const MAX_CACHE_ENTRIES = 8

/** @type {Map<string, { timingMap: object, fileName: string | null, parsedAt: number }>} */
const timingMapCache = new Map()

/** @type {{ marks: Array<object> }} */
const prepMarks = { marks: [] }

export function resolveMusicXmlContentHash(musicXmlInput) {
  return contentIdentitySync(musicXmlInput)?.hash ?? null
}

export function getCachedTimingMap(contentHash) {
  if (!contentHash) {
    return null
  }
  const entry = timingMapCache.get(contentHash)
  if (!entry) {
    return null
  }
  // Refresh LRU order
  timingMapCache.delete(contentHash)
  timingMapCache.set(contentHash, entry)
  return entry.timingMap
}

export function setCachedTimingMap(contentHash, timingMap, fileName = null) {
  if (!contentHash || !timingMap) {
    return
  }
  if (timingMapCache.has(contentHash)) {
    timingMapCache.delete(contentHash)
  }
  timingMapCache.set(contentHash, {
    timingMap,
    fileName: fileName ?? null,
    parsedAt: performance.now?.() ?? Date.now(),
  })
  while (timingMapCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = timingMapCache.keys().next().value
    timingMapCache.delete(oldestKey)
  }
}

export function clearTimingMapCache(contentHash = null) {
  if (contentHash == null) {
    timingMapCache.clear()
    return
  }
  timingMapCache.delete(contentHash)
}

/**
 * Parse MusicXml once per content hash. Returns the cached map on hit.
 */
export function getOrParseTimingMap(musicXmlString, fileName = 'score.musicxml', options = {}) {
  const startedAt = performance.now?.() ?? Date.now()
  const contentHash =
    options.contentHash ?? resolveMusicXmlContentHash(musicXmlString)
  if (contentHash) {
    const cached = getCachedTimingMap(contentHash)
    if (cached) {
      markPracticePrepStage('timing-parse-cache-hit', {
        contentHash,
        fileName,
        durationMs: (performance.now?.() ?? Date.now()) - startedAt,
      })
      return {
        timingMap: cached,
        contentHash,
        fromCache: true,
        durationMs: (performance.now?.() ?? Date.now()) - startedAt,
      }
    }
  }

  const timingMap = parseMusicXml(musicXmlString, fileName)
  if (contentHash) {
    timingMap.contentHash = contentHash
    setCachedTimingMap(contentHash, timingMap, fileName)
  }
  const durationMs = (performance.now?.() ?? Date.now()) - startedAt
  markPracticePrepStage('timing-parse', {
    contentHash,
    fileName,
    durationMs,
    noteCount: timingMap?.noteCount ?? timingMap?.notes?.length ?? null,
    measureCount: timingMap?.measures?.length ?? null,
  })
  return {
    timingMap,
    contentHash,
    fromCache: false,
    durationMs,
  }
}

export function markPracticePrepStage(stage, detail = {}) {
  const entry = {
    stage,
    at: performance.now?.() ?? Date.now(),
    ...detail,
  }
  prepMarks.marks.push(entry)
  if (prepMarks.marks.length > 64) {
    prepMarks.marks.splice(0, prepMarks.marks.length - 64)
  }
  if (typeof window !== 'undefined') {
    window.__SCOREFLOW_PRACTICE_PREP__ = {
      marks: [...prepMarks.marks],
      last: entry,
    }
  }
  try {
    if (typeof performance !== 'undefined' && performance.mark) {
      performance.mark(`practice-prep:${stage}`)
    }
  } catch {
    // ignore
  }
  return entry
}

export function getPracticePrepMarks() {
  return [...prepMarks.marks]
}

export function clearPracticePrepMarks() {
  prepMarks.marks.length = 0
  if (typeof window !== 'undefined') {
    window.__SCOREFLOW_PRACTICE_PREP__ = { marks: [], last: null }
  }
}

/** Test helper */
export function __timingMapCacheSizeForTests() {
  return timingMapCache.size
}
