/**
 * Heavy-score responsiveness harness (relative budgets).
 *
 * Profiles parse + visual-lane build + cache reuse for:
 * - small beginner fixture
 * - medium grand-voices / evangelion-scale fixture when available
 * - La Campanella / dense advanced fixture
 *
 * Does not run OMR recognition. Writes JSON under tmp/user-stability-performance/.
 *
 * Usage: node scripts/heavy-score-performance-harness.mjs
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clearTimingMapCache,
  clearPracticePrepMarks,
  getOrParseTimingMap,
  getPracticePrepMarks,
} from '../src/features/musicxml/timingMapCache.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import { selectVisualWindow } from '../src/features/practice/visualPracticeLane.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'tmp/user-stability-performance')

function readXml(...parts) {
  const path = join(root, ...parts)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

function time(fn) {
  const t0 = performance.now()
  const value = fn()
  return { value, ms: performance.now() - t0 }
}

function profileScore(label, xml) {
  if (!xml) {
    return { label, skipped: true }
  }
  clearTimingMapCache()
  clearPracticePrepMarks()

  const coldParse = time(() => getOrParseTimingMap(xml, `${label}.musicxml`))
  const hotParse = time(() => getOrParseTimingMap(xml, `${label}.musicxml`))
  const map = coldParse.value.timingMap
  const coldGroups = time(() =>
    buildVisualLaneGroups(map, null, { instrumentId: 'piano' }),
  )
  const hotGroups = time(() =>
    buildVisualLaneGroups(map, null, { instrumentId: 'piano' }),
  )
  const windowed = time(() =>
    selectVisualWindow(coldGroups.value, 0, 0),
  )

  return {
    label,
    skipped: false,
    noteCount: map.noteCount ?? map.notes?.length ?? 0,
    measureCount: map.measures?.length ?? 0,
    coldParseMs: coldParse.ms,
    hotParseMs: hotParse.ms,
    fromCache: hotParse.value.fromCache,
    coldVisualGroupsMs: coldGroups.ms,
    hotVisualGroupsMs: hotGroups.ms,
    visualGroupCount: coldGroups.value.length,
    windowedGroupCount: windowed.value.length,
    windowedMs: windowed.ms,
    prepMarks: getPracticePrepMarks(),
  }
}

const small = readXml(
  'benchmarks/omr-fixtures/piano-beginner-single-vector/piano-beginner-single-vector.musicxml',
)
const medium = readXml(
  'benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.musicxml',
)
const dense =
  readXml('tmp/omr-quality-campaign/baseline/generated/la-campanella.musicxml') ||
  readXml('benchmarks/omr-fixtures/piano-dense-advanced-vector/piano-dense-advanced-vector.musicxml')

const results = {
  at: new Date().toISOString(),
  scores: [
    profileScore('small', small),
    profileScore('medium-evangelion-scale', medium),
    profileScore('dense-la-campanella', dense),
  ],
}

const smallResult = results.scores[0]
const denseResult = results.scores[2]
if (!smallResult.skipped && !denseResult.skipped) {
  results.relative = {
    denseParseOverSmall: denseResult.coldParseMs / Math.max(1, smallResult.coldParseMs),
    denseVisualOverSmall:
      denseResult.coldVisualGroupsMs / Math.max(1, smallResult.coldVisualGroupsMs),
    cacheParseSpeedup: smallResult.coldParseMs / Math.max(0.001, smallResult.hotParseMs),
    cacheVisualSpeedup:
      denseResult.coldVisualGroupsMs / Math.max(0.001, denseResult.hotVisualGroupsMs),
  }
  results.assertions = {
    hotParseUsesCache: denseResult.fromCache === true,
    visualWindowSmallerThanFull:
      denseResult.windowedGroupCount < denseResult.visualGroupCount ||
      denseResult.visualGroupCount < 40,
    denseParseRelativeBudget: results.relative.denseParseOverSmall < 200,
    visualCacheSpeedup: results.relative.cacheVisualSpeedup >= 1.5,
  }
  results.ok = Object.values(results.assertions).every(Boolean)
} else {
  results.ok = false
  results.error = 'Missing fixtures'
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'heavy-score-harness.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
if (!results.ok) {
  process.exit(1)
}
console.log('PASS heavy-score-performance-harness')
