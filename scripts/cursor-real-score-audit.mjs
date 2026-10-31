#!/usr/bin/env node
/**
 * Deterministic audit of the shipped motion timeline against a real score's
 * calibrated anchors (extracted from the live app's React fiber).
 */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildCursorMotionTimeline, resolveCursorMotion } from '../src/features/score-follow/cursorMotionTimeline.js'
import { measureCursorOnsetAlignment } from '../src/features/score-follow/scoreFollowPrecisionDiagnostics.js'

const dataPath = process.argv[2]
const xmlPath = process.argv[3]
const data = JSON.parse(readFileSync(dataPath, 'utf8'))
async function readXml(path) {
  const raw = readFileSync(path)
  if (!path.toLowerCase().endsWith('.mxl')) return raw.toString('utf8')
  const zip = await JSZip.loadAsync(raw)
  const container = zip.file('META-INF/container.xml')
  let root = null
  if (container) { const xml = await container.async('string'); root = xml.match(/full-path="([^"]+)"/)?.[1] ?? null }
  if (!root || !zip.file(root)) root = Object.keys(zip.files).find((e) => e.toLowerCase().endsWith('.xml') && !e.startsWith('META-INF/'))
  return zip.file(root).async('string')
}
const timingMap = parseMusicXml(await readXml(xmlPath), data.scoreTitle)
const anchors = data.anchors
const timeline = buildCursorMotionTimeline({ timingMap, trustedAnchors: anchors })
const report = measureCursorOnsetAlignment({ timingMap, trustedAnchors: anchors, motionTimeline: timeline })

const nullRuns = []
let runStart = null
let nullCount = 0
let backward = 0
let maxBackward = 0
let prev = null
const duration = timingMap.durationSeconds ?? timeline.duration
const step = 0.001
for (let t = 0; t <= duration; t += step) {
  const c = resolveCursorMotion(timeline, t)
  if (!c) {
    nullCount += 1
    if (runStart == null) runStart = t
  } else {
    if (runStart != null) { nullRuns.push({ from: runStart, to: t }); runStart = null }
    if (prev && c.phraseIndex === prev.phraseIndex) {
      const dx = c.x - prev.x
      if (dx < -1e-6) { backward += 1; maxBackward = Math.min(maxBackward, dx) }
    }
    prev = c
  }
}
if (runStart != null) nullRuns.push({ from: runStart, to: duration })

const boundaries = []
for (let i = 1; i < timeline.phrases.length; i += 1) {
  const phrase = timeline.phrases[i]
  const boundary = phrase.startTime
  let switchAt = null
  const start = boundary - 0.02
  for (let t = start; t <= boundary + 0.002; t += 0.0001) {
    const c = resolveCursorMotion(timeline, t)
    if (c && c.phraseIndex === phrase.index) { switchAt = t; break }
  }
  boundaries.push({ from: { page: timeline.phrases[i-1].page, system: timeline.phrases[i-1].systemIndex, measure: timeline.phrases[i-1].knots.at(-1)?.measureNumber }, to: { page: phrase.page, system: phrase.systemIndex, measure: phrase.knots[0]?.measureNumber }, boundary, switchAt, earlyMs: switchAt != null ? (boundary - switchAt) * 1000 : null })
}

let measureStartMisses = []
const performedEntries = timingMap.performedMeasureTimeline?.entries ?? null
const startChecks = performedEntries
  ? performedEntries.map((entry) => ({ measure: entry.writtenMeasureNumber, start: entry.startTimeSeconds, repeatPass: entry.repeatPass ?? 1 }))
  : timingMap.measures.map((measure) => ({ measure: measure.number, start: measure.startTimeSeconds, repeatPass: 1 }))
for (const check of startChecks) {
  const c = resolveCursorMotion(timeline, check.start + 0.0005)
  if (!c || c.measureNumber !== check.measure) {
    measureStartMisses.push({ measure: check.measure, start: check.start, repeatPass: check.repeatPass, got: c ? c.measureNumber : null })
  }
}

console.log(JSON.stringify({
  score: data.scoreTitle,
  measures: timingMap.measures.length,
  phrases: timeline.phrases.length,
  duration,
  onset: { samples: report.sampleCount, avgErrorX: report.averageErrorX, maxErrorX: report.maxErrorX, teleports: report.midSystemTeleports, wrongPage: report.wrongPagePlacements, jumps: report.visibleJumps, explained: report.explainedJumps },
  timelineNullMs: nullCount * step * 1000,
  timelineNullRuns: nullRuns.slice(0, 10),
  backwardSteps: backward,
  maxBackward,
  boundaries,
  measureStartMisses,
}, null, 2))
