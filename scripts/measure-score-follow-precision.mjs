#!/usr/bin/env node
/**
 * Score-follow precision harness (S8/S9, node side).
 *
 * Runs the SHIPPED cursor path (motion timeline + shared display resolver)
 * against every representative MusicXML fixture and reports:
 *  - note-onset alignment error (displayed cursor vs musical ideal)
 *  - cursor-vs-highlight agreement (bar vs blue box: independent paths)
 *  - wrong-page placements, backward jumps, NaN/invisible failures
 *  - engraved-vs-time geometry provenance mix (honest precision taxonomy)
 *
 * Anchors are SYNTHETIC (MusicXML system breaks paginated into fake pages):
 * they exercise the resolver math across real rhythmic content (ties,
 * tuplets, repeats, multi-voice, dense piano, guitar TAB) but are NOT PDF
 * truth. Anything this harness calls "engraved-mapped" is engraved-geometry
 * consistency, not printed-ink accuracy — printed-ink validation is the
 * browser pixel pass (scripts/browser-score-follow-precision-e2e.mjs).
 *
 *   node scripts/measure-score-follow-precision.mjs [--json out.json]
 *
 * Output: tmp/score-follow-precision/{report.json,report.md}
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { groupMeasuresBySystemBreaks } from '../src/features/score-follow/allocateMeasuresToSystems.js'
import { buildCursorMotionTimeline } from '../src/features/score-follow/cursorMotionTimeline.js'
import { resolveDisplayCursorAtTime } from '../src/features/score-follow/scoreFollowDisplayPosition.js'
import {
  measureCursorHighlightAgreement,
  measureCursorOnsetAlignment,
} from '../src/features/score-follow/scoreFollowPrecisionDiagnostics.js'
import { buildNoteCheckpoints } from '../src/features/practice/waitForYouCheckpoints.js'
import { resolveNoteTargetPosition } from '../src/features/practice/noteTargetPosition.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const outDir = join(root, 'tmp', 'score-follow-precision')

const SYSTEMS_PER_PAGE = 4
const SYSTEM_Y_TOP = 0.18
const SYSTEM_Y_BOTTOM = 0.82

async function readScoreXml(scorePath) {
  const data = await readFile(scorePath)
  if (!scorePath.toLowerCase().endsWith('.mxl')) {
    return data.toString('utf8')
  }
  const zip = await JSZip.loadAsync(data)
  const container = zip.file('META-INF/container.xml')
  let rootPath = null
  if (container) {
    const xml = await container.async('string')
    rootPath = xml.match(/full-path="([^"]+)"/)?.[1] ?? null
  }
  if (!rootPath || !zip.file(rootPath)) {
    rootPath = Object.keys(zip.files).find(
      (entry) => entry.toLowerCase().endsWith('.xml') && !entry.startsWith('META-INF/'),
    )
  }
  if (!rootPath || !zip.file(rootPath)) {
    throw new Error(`MXL archive has no MusicXML root: ${scorePath}`)
  }
  return zip.file(rootPath).async('string')
}

/**
 * Synthetic per-measure anchors from the score's own system breaks,
 * paginated into fake pages. Source 'manual' so the trust filter keeps
 * them; meta carries playable spans like the real pipeline.
 */
function buildSyntheticAnchors(timingMap) {
  const measureNumbers = (timingMap?.measures ?? []).map((m) => m.number)
  if (measureNumbers.length === 0) {
    return { anchors: [], systems: [] }
  }
  const groups = groupMeasuresBySystemBreaks(measureNumbers, timingMap)
  const systems = groups.length > 0 ? groups : [measureNumbers]
  const anchors = []
  systems.forEach((systemMeasures, systemIndex) => {
    const page = Math.floor(systemIndex / SYSTEMS_PER_PAGE) + 1
    const rowInPage = systemIndex % SYSTEMS_PER_PAGE
    const y =
      SYSTEMS_PER_PAGE === 1
        ? (SYSTEM_Y_TOP + SYSTEM_Y_BOTTOM) / 2
        : SYSTEM_Y_TOP +
          (rowInPage / (SYSTEMS_PER_PAGE - 1)) * (SYSTEM_Y_BOTTOM - SYSTEM_Y_TOP)
    const count = systemMeasures.length
    systemMeasures.forEach((measureNumber, indexInSystem) => {
      const xStart = 0.08 + (indexInSystem / Math.max(1, count)) * 0.84
      const xEnd = 0.08 + ((indexInSystem + 1) / Math.max(1, count)) * 0.84
      const beatX = xStart + (xEnd - xStart) * 0.18
      anchors.push({
        id: `synth-m${measureNumber}`,
        page,
        x: beatX,
        y,
        measureNumber,
        source: 'manual',
        meta: {
          role: 'measure',
          systemIndex,
          measureStartX: xStart,
          playableStartX: beatX,
          playableEndX: xEnd - (xEnd - xStart) * 0.08,
          systemEndX: 0.94,
        },
      })
    })
  })
  return { anchors, systems }
}

async function collectScores() {
  const scores = []
  const fixtureDir = join(root, 'public', 'fixtures')
  for (const entry of await readdir(fixtureDir, { withFileTypes: true })) {
    const full = join(fixtureDir, entry.name)
    if (entry.isFile() && /\.(musicxml|xml|mxl)$/i.test(entry.name)) {
      scores.push(full)
    } else if (entry.isDirectory()) {
      for (const sub of await readdir(full)) {
        if (/\.(musicxml|xml|mxl)$/i.test(sub)) {
          scores.push(join(full, sub))
        }
      }
    }
  }
  // Practice library sample (guitar notation/TAB + piano variety).
  const libManifest = join(fixtureDir, 'practice-library', 'manifest.json')
  try {
    const manifest = JSON.parse(await readFile(libManifest, 'utf8'))
    const items = Array.isArray(manifest) ? manifest : manifest.items ?? manifest.pieces ?? []
    for (const item of items.slice(0, 12)) {
      const rel = item.musicxml ?? item.path ?? item.file ?? null
      if (rel) {
        scores.push(join(fixtureDir, 'practice-library', rel))
      }
    }
  } catch {
    // Library manifest shape differs; directory scan below covers it.
  }
  const libDir = join(fixtureDir, 'practice-library')
  try {
    for (const entry of await readdir(libDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }
      const pieceDir = join(libDir, entry.name)
      for (const sub of await readdir(pieceDir)) {
        if (/\.(musicxml|xml|mxl)$/i.test(sub)) {
          const full = join(pieceDir, sub)
          if (!scores.includes(full)) {
            scores.push(full)
          }
          break
        }
      }
      if (scores.length >= 24) {
        break
      }
    }
  } catch {
    // No practice library present.
  }
  return [...new Set(scores)].sort()
}

function summarizeScore(name, timingMap, anchors, checkpoints, motionTimeline) {
  const trust = { showCursor: true, needsSetup: false }
  const onset = measureCursorOnsetAlignment({
    timingMap,
    trustedAnchors: anchors,
    trust,
    motionTimeline,
    sampleEvery: 1,
  })
  const agreement = measureCursorHighlightAgreement({
    checkpoints,
    resolveCursorAt: (time) =>
      resolveDisplayCursorAtTime({
        timingMap,
        trustedAnchors: anchors,
        trust,
        practiceTime: time,
        motionTimeline,
      }),
    resolveTarget: (checkpoint) =>
      resolveNoteTargetPosition({
        checkpoint,
        timingMap,
        anchors,
        mode: 'wait-for-you',
        motionTimeline,
      }),
    sampleEvery: 1,
  })

  // Forward-motion audit on the displayed cursor across checkpoints:
  // backward x-steps inside one page+system are stalls/jitter; NaN is fatal.
  let nanCount = 0
  let invisibleCount = 0
  let backwardSteps = 0
  let prev = null
  for (const checkpoint of checkpoints) {
    const cursor = resolveDisplayCursorAtTime({
      timingMap,
      trustedAnchors: anchors,
      trust,
      practiceTime: checkpoint.timeSeconds,
      motionTimeline,
    })
    if (!cursor?.visible) {
      invisibleCount += 1
      prev = null
      continue
    }
    if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
      nanCount += 1
      prev = null
      continue
    }
    if (
      prev &&
      cursor.page === prev.page &&
      (cursor.systemIndex ?? -1) === (prev.systemIndex ?? -2) &&
      cursor.x < prev.x - 1e-4 &&
      (checkpoint.repeatPass ?? 1) === (prev.repeatPass ?? 1)
    ) {
      backwardSteps += 1
    }
    prev = { ...cursor, repeatPass: checkpoint.repeatPass ?? 1 }
  }

  const measureSpanX =
    anchors.length > 1
      ? Math.max(
          0.04,
          Math.max(...anchors.map((a) => a.x)) - Math.min(...anchors.map((a) => a.x)),
        )
      : 0.5
  return {
    checkpoints: checkpoints.length,
    onset: {
      samples: onset.sampleCount,
      avgErrorX: onset.averageErrorX,
      maxErrorX: onset.maxErrorX,
      avgErrorMeasureWidths:
        onset.sampleCount > 0 ? onset.averageErrorX / measureSpanX : 0,
      maxErrorMeasureWidths: onset.maxErrorX / measureSpanX,
      jumps: onset.visibleJumps,
      explainedJumps: onset.explainedJumps,
      teleports: onset.midSystemTeleports,
      teleportSamples: onset.teleportSamples,
      wrongPage: onset.wrongPagePlacements,
      precision: onset.precisionCounts,
    },
    agreement: {
      samples: agreement.sampleCount,
      skipped: agreement.skipped,
      avgErrorX: agreement.averageErrorX,
      maxErrorX: agreement.maxErrorX,
      inMeasureSamples: agreement.inMeasureSampleCount,
      inMeasureAvgErrorX: agreement.inMeasureAverageErrorX,
      inMeasureMaxErrorX: agreement.inMeasureMaxErrorX,
      overflowSamples: agreement.overflowSampleCount,
      overflowMaxErrorX: agreement.overflowMaxErrorX,
      wrongPage: agreement.wrongPagePlacements,
      wrongSystem: agreement.wrongSystemPlacements,
    },
    motion: {
      nan: nanCount,
      invisible: invisibleCount,
      backwardSteps,
      phrases: motionTimeline?.phrases?.length ?? 0,
      geometry: (motionTimeline?.phrases ?? []).reduce((acc, phrase) => {
        const key = phrase.geometryMode ?? 'unknown'
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {}),
    },
  }
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const jsonArg = process.argv.find((arg) => arg === '--json')
    ? process.argv[process.argv.indexOf('--json') + 1]
    : null
  const scores = await collectScores()
  const results = []
  for (const scorePath of scores) {
    const name = scorePath.startsWith(root)
      ? scorePath.slice(root.length + 1)
      : basename(scorePath)
    try {
      const xml = await readScoreXml(scorePath)
      const timingMap = parseMusicXml(xml, basename(scorePath))
      const measureCount = timingMap?.measures?.length ?? 0
      if (measureCount === 0) {
        results.push({ score: name, ok: false, reason: 'no-measures-parsed' })
        continue
      }
      const { anchors, systems } = buildSyntheticAnchors(timingMap)
      const checkpoints = buildNoteCheckpoints(timingMap)
      const motionTimeline = buildCursorMotionTimeline({
        timingMap,
        trustedAnchors: anchors,
      })
      const summary = summarizeScore(name, timingMap, anchors, checkpoints, motionTimeline)
      results.push({
        score: name,
        ok: true,
        measures: measureCount,
        systems: systems.length,
        pages: Math.max(...anchors.map((a) => a.page)),
        notes: timingMap.notes?.length ?? 0,
        ...summary,
      })
      console.log(
        `OK   ${name} m=${measureCount} cp=${summary.checkpoints} ` +
          `onsetMax=${summary.onset.maxErrorX.toFixed(4)} agreeMax=${summary.agreement.maxErrorX.toFixed(4)} ` +
          `wrongPage=${summary.onset.wrongPage + summary.agreement.wrongPage} nan=${summary.motion.nan}`,
      )
    } catch (error) {
      results.push({ score: name, ok: false, reason: error?.message ?? String(error) })
      console.error(`FAIL ${name}: ${error?.message ?? error}`)
    }
  }

  const okResults = results.filter((r) => r.ok)
  const totals = {
    scores: results.length,
    ok: okResults.length,
    failed: results.filter((r) => !r.ok),
    totalCheckpoints: okResults.reduce((sum, r) => sum + r.checkpoints, 0),
    maxOnsetErrorX: Math.max(0, ...okResults.map((r) => r.onset.maxErrorX)),
    maxAgreementErrorX: Math.max(0, ...okResults.map((r) => r.agreement.maxErrorX)),
    totalWrongPage: okResults.reduce((sum, r) => sum + r.onset.wrongPage + r.agreement.wrongPage, 0),
    totalWrongSystem: okResults.reduce((sum, r) => sum + r.agreement.wrongSystem, 0),
    totalNan: okResults.reduce((sum, r) => sum + r.motion.nan, 0),
    totalInvisible: okResults.reduce((sum, r) => sum + r.motion.invisible, 0),
    totalBackward: okResults.reduce((sum, r) => sum + r.motion.backwardSteps, 0),
    totalJumps: okResults.reduce((sum, r) => sum + r.onset.jumps, 0),
    totalExplainedJumps: okResults.reduce((sum, r) => sum + (r.onset.explainedJumps ?? 0), 0),
    totalTeleports: okResults.reduce((sum, r) => sum + (r.onset.teleports ?? 0), 0),
  }

  const report = { generatedAt: new Date().toISOString(), totals, results }
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  const lines = [
    '# Score-follow precision harness (node)',
    '',
    `Generated: ${report.generatedAt}`,
    `Scores: ${totals.ok}/${totals.scores} parsed`,
    `Checkpoints: ${totals.totalCheckpoints}`,
    '',
    '| score | meas | cp | onset max (pg) | agree max (pg) | wrongPg | nan | back | geom |',
    '|---|---|---|---|---|---|---|---|---|',
  ]
  for (const r of results) {
    if (!r.ok) {
      lines.push(`| ${r.score} | — | — | FAILED: ${r.reason} | | | | | |`)
      continue
    }
    lines.push(
      `| ${r.score} | ${r.measures} | ${r.checkpoints} | ${r.onset.maxErrorX.toFixed(4)} | ` +
        `${r.agreement.maxErrorX.toFixed(4)} | ${r.onset.wrongPage + r.agreement.wrongPage} | ` +
        `${r.motion.nan} | ${r.motion.backwardSteps} | ${JSON.stringify(r.motion.geometry)} |`,
    )
  }
  lines.push(
    '',
    `Totals: wrongPage=${totals.totalWrongPage} wrongSystem=${totals.totalWrongSystem} ` +
      `nan=${totals.totalNan} invisible=${totals.totalInvisible} backward=${totals.totalBackward} jumps=${totals.totalJumps}`,
    `maxOnset=${totals.maxOnsetErrorX.toFixed(4)} maxAgreement=${totals.maxAgreementErrorX.toFixed(4)} (page units)`,
  )
  await writeFile(join(outDir, 'report.md'), `${lines.join('\n')}\n`)
  if (jsonArg) {
    await writeFile(jsonArg, JSON.stringify(report, null, 2))
  }
  console.log(`\n${totals.ok}/${totals.scores} scores, report in ${outDir}`)

  // Hard gates: NaN coordinates and wrong-page placements are never acceptable.
  const hardFail = totals.totalNan > 0 || totals.totalWrongPage > 0
  process.exit(hardFail ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
