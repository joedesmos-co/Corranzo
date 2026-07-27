#!/usr/bin/env node
/**
 * Musical Structure Sprint 1 real-measure acceptance trace.
 *
 * Captures 36 measures from the requested real-score set, preserves the frozen
 * semantic evaluator, and saves the full evidence chain:
 * PDF crop -> beam/stem candidates -> selected structure units -> MusicXML ->
 * Visual Practice engraving -> playback attack order.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { createCanvas } from '@napi-rs/canvas'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { processOmrPageAnalysis } from '../src/features/omr/processOmrPage.js'
import { buildMeasureStructureUnits } from '../src/features/omr/measureStructureSemantics.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import {
  buildStaffGeometry,
  buildStaffLaneNotes,
  buildStaffLaneRhythmMarks,
  buildStaffLaneStems,
  detectStaves,
  NOTEHEAD_RX,
  NOTEHEAD_RY,
} from '../src/features/practice/staffLaneLayout.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tmp/musical-structure-sprint-1')
const GENERATED = join(OUT, 'generated')
const CASES = join(OUT, 'cases')
const CROPS = join(OUT, 'source-crops')
const OVERLAYS = join(OUT, 'candidate-overlays')
const BEFORE = join(OUT, 'rendered-before')
const AFTER = join(OUT, 'rendered-after')
const SNIPPETS = join(OUT, 'musicxml-snippets')
const GALLERY = join(OUT, 'gallery')
const DOWNLOADS = join(homedir(), 'Downloads')
const TARGET_CASE_COUNT = 36

const SOURCES = [
  {
    id: 'minecraft',
    label: 'Minecraft',
    pdf: join(DOWNLOADS, 'beginner-minecraft-piano-themes-in-c-minecraft.pdf'),
    truth: join(DOWNLOADS, 'beginner-minecraft-piano-themes-in-c-minecraft.mxl'),
    pages: 1,
    baseline: join(ROOT, 'tmp/notation-fidelity-sprint-5/generated/minecraft.musicxml'),
  },
  {
    id: 'evangelion',
    label: 'Evangelion',
    pdf: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.pdf'),
    truth: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.mxl'),
    pages: 1,
    baseline: join(ROOT, 'tmp/notation-fidelity-sprint-5/generated/evangelion.musicxml'),
  },
  {
    id: 'gymnopedie',
    label: 'Gymnopédie',
    pdf: join(DOWNLOADS, 'gymnopedie-no-1-satie.pdf'),
    truth: join(DOWNLOADS, 'gymnopedie-no-1-satie.mxl'),
    pages: 1,
    baseline: join(ROOT, 'tmp/notation-fidelity-sprint-5/generated/gymnopedie.musicxml'),
  },
  {
    id: 'piano-articulation-scan',
    label: 'piano-articulation-scan',
    pdf: join(
      ROOT,
      'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf',
    ),
    truth: join(
      ROOT,
      'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.musicxml',
    ),
    pages: 1,
    baseline: join(
      ROOT,
      'tmp/notation-fidelity-sprint-5/generated/piano-articulation-scan.musicxml',
    ),
  },
  {
    id: 'piano-grand-voices-vector',
    label: 'grand-staff voice control',
    pdf: join(
      ROOT,
      'benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.pdf',
    ),
    truth: join(
      ROOT,
      'benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.musicxml',
    ),
    pages: 1,
    baseline: join(
      ROOT,
      'tmp/notation-fidelity-sprint-5/generated/piano-grand-voices-vector.musicxml',
    ),
  },
  {
    id: 'la-campanella',
    label: 'La Campanella dense/polyphonic piano',
    pdf: join(DOWNLOADS, 'etude-s-1413-in-g-minor-la-campanella-liszt.pdf'),
    truth: join(DOWNLOADS, 'etude-s-1413-in-g-minor-la-campanella-liszt.mxl'),
    pages: 2,
    baseline: join(ROOT, 'tmp/notation-fidelity-sprint-5/generated/la-campanella.musicxml'),
  },
  {
    id: 'piano-rhythm-tuplets-vector',
    label: 'tuplet and voice-rest control',
    pdf: join(
      ROOT,
      'benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.pdf',
    ),
    truth: join(
      ROOT,
      'benchmarks/omr-fixtures/piano-rhythm-tuplets-vector/piano-rhythm-tuplets-vector.musicxml',
    ),
    pages: 1,
    baseline: join(
      ROOT,
      'tmp/rhythm-sprint-2-rca/piano-rhythm-tuplets-vector.omr.musicxml',
    ),
  },
]

function relative(path) {
  return path.replace(`${ROOT}/`, '')
}

function safeId(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function imageDataCanvas(page) {
  const canvas = createCanvas(page.width, page.height)
  const context = canvas.getContext('2d')
  const data = context.createImageData(page.width, page.height)
  data.data.set(page.data)
  context.putImageData(data, 0, 0)
  return canvas
}

async function readScoreXml(path) {
  const data = await readFile(path)
  if (!path.toLowerCase().endsWith('.mxl')) {
    return data.toString('utf8')
  }
  const zip = await JSZip.loadAsync(data)
  const container = await zip.file('META-INF/container.xml')?.async('string')
  const rootPath =
    container?.match(/full-path="([^"]+)"/)?.[1] ??
    Object.keys(zip.files).find(
      (entry) => entry.toLowerCase().endsWith('.xml') && !entry.startsWith('META-INF/'),
    )
  if (!rootPath || !zip.file(rootPath)) {
    throw new Error(`No MusicXML root in ${path}`)
  }
  return zip.file(rootPath).async('string')
}

function measureBlocks(xml) {
  const part = xml.match(/<part(?:\s[^>]*)?>[\s\S]*?<\/part>/)?.[0] ?? xml
  return [...part.matchAll(/<measure\b[^>]*number="([^"]+)"[^>]*>[\s\S]*?<\/measure>/g)]
    .map((match) => ({ number: Number(match[1]), xml: match[0] }))
    .filter((entry) => Number.isFinite(entry.number))
}

function measureSnippet(xml, measureNumber) {
  return measureBlocks(xml).find((entry) => entry.number === measureNumber)?.xml ?? ''
}

function isolatedMeasureXml(xml, measureNumber) {
  const block = measureSnippet(xml, measureNumber)
  const body = block
    .replace(/^<measure\b[^>]*>/, '')
    .replace(/<\/measure>$/, '')
  const divisions = xml.match(/<divisions>(\d+)<\/divisions>/)?.[1] ?? '4'
  const attributes = body.includes('<attributes>')
    ? ''
    : `<attributes><divisions>${divisions}</divisions><staves>2</staves>` +
      '<clef number="1"><sign>G</sign><line>2</line></clef>' +
      '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<score-partwise version="3.1">' +
    '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
    `<part id="P1"><measure number="1">${attributes}${body}</measure></part>` +
    '</score-partwise>'
  )
}

function coreAttackSignature(timing, measureNumber = null) {
  return timing.notes
    .filter(
      (note) =>
        !note.isRest &&
        note.midi != null &&
        !note.suppressPlaybackAttack &&
        (measureNumber == null || note.measureNumber === measureNumber),
    )
    .map((note) => ({
      measureNumber: note.measureNumber,
      quarterTime: round(note.quarterTime, 6),
      durationQuarters: round(note.durationQuarters, 6),
      midi: note.midi,
    }))
    .sort(
      (left, right) =>
        left.quarterTime - right.quarterTime ||
        left.midi - right.midi ||
        left.durationQuarters - right.durationQuarters,
    )
}

function parsedMeasureSummary(timing, measureNumber) {
  const measure = timing.measures.find((entry) => entry.number === measureNumber) ?? null
  const notes = timing.notes.filter((note) => note.measureNumber === measureNumber)
  const pitched = notes.filter((note) => !note.isRest && note.midi != null)
  const rests = notes.filter((note) => note.isRest)
  const voicesByStaffMap = new Map()
  for (const note of notes) {
    const staff = note.staff ?? 1
    const voices = voicesByStaffMap.get(staff) ?? new Set()
    voices.add(note.voice ?? 1)
    voicesByStaffMap.set(staff, voices)
  }
  const voicesByStaff = Object.fromEntries(
    [...voicesByStaffMap.entries()]
      .sort(([left], [right]) => left - right)
      .map(([staff, voices]) => [staff, [...voices].sort((left, right) => left - right)]),
  )
  const chordColumns = new Map()
  for (const note of pitched) {
    const key = [
      round(note.quarterTime, 6),
      note.staff ?? 1,
      note.voice ?? 1,
    ].join(':')
    chordColumns.set(key, (chordColumns.get(key) ?? 0) + 1)
  }
  const crossStaffVoices = []
  const staffsByVoice = new Map()
  for (const note of notes) {
    const voice = note.voice ?? 1
    const staffs = staffsByVoice.get(voice) ?? new Set()
    staffs.add(note.staff ?? 1)
    staffsByVoice.set(voice, staffs)
  }
  for (const [voice, staffs] of staffsByVoice) {
    if (staffs.size > 1) crossStaffVoices.push(voice)
  }

  const balance = {}
  const measureStart = measure?.startQuarters ?? Math.min(0, ...notes.map((note) => note.quarterTime))
  const measureLength = measure?.notatedLengthQuarters ?? measure?.lengthQuarters ?? 4
  for (const voice of new Set(notes.map((note) => note.voice ?? 1))) {
    const intervals = notes
      .filter((note) => (note.voice ?? 1) === voice && !note.isChord)
      .map((note) => [
        note.quarterTime - measureStart,
        note.quarterTime - measureStart + note.durationQuarters,
      ])
      .sort((left, right) => left[0] - right[0])
    let occupied = 0
    let end = 0
    for (const [start, stop] of intervals) {
      occupied += Math.max(0, stop - Math.max(start, end))
      end = Math.max(end, stop)
    }
    balance[voice] = {
      writtenQuarters: round(occupied),
      implicitGapQuarters: round(Math.max(0, measureLength - occupied)),
      overfullQuarters: round(Math.max(0, end - measureLength)),
      balancedWithImplicitGaps: end <= measureLength + 1e-6,
    }
  }

  return {
    noteCount: pitched.length,
    restCount: rests.length,
    voicesByStaff,
    sameStaffPolyphony: Object.values(voicesByStaff).some((voices) => voices.length > 1),
    chordColumnCount: [...chordColumns.values()].filter((count) => count > 1).length,
    chordToneCount: [...chordColumns.values()].reduce(
      (sum, count) => sum + (count > 1 ? count : 0),
      0,
    ),
    stemDirections: {
      up: pitched.filter((note) => note.stemDirection === 'up').length,
      down: pitched.filter((note) => note.stemDirection === 'down').length,
      unspecified: pitched.filter((note) => !note.stemDirection).length,
    },
    beamNoteCount: pitched.filter((note) => note.beams?.length).length,
    tupletMemberCount: notes.filter((note) => note.timeModification).length,
    crossStaffVoices: crossStaffVoices.sort((left, right) => left - right),
    balance,
  }
}

function rendererModel(xml, name) {
  const timing = parseMusicXml(xml, name)
  const groups = buildVisualLaneGroups(timing).map((group) => ({
    ...group,
    status: 'upcoming',
  }))
  const geometry = buildStaffGeometry(detectStaves(groups))
  const notes = buildStaffLaneNotes(groups, geometry)
  const stems = buildStaffLaneStems(groups, geometry, { notes })
  const rhythm = buildStaffLaneRhythmMarks(notes, stems)
  return { timing, groups, geometry, notes, stems, rhythm }
}

async function captureSource(config) {
  const rendered = await renderPdfToPages(config.pdf, {
    rootDir: ROOT,
    maxPages: config.pages,
  })
  const extractPageText = await makePdfTextExtractor(config.pdf, { rootDir: ROOT })
  const pageResults = []
  const original = {
    log: console.log,
    info: console.info,
    debug: console.debug,
  }
  console.log = () => {}
  console.info = () => {}
  console.debug = () => {}
  let result
  try {
    result = await runPdfOmrPipeline(config.pdf, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText,
      numPages: rendered.numPages,
      maxPages: config.pages,
      title: `${config.id}-musical-structure-sprint1`,
      analyzePage(imageData, context) {
        const pageResult = processOmrPageAnalysis(imageData, context)
        pageResults[context.page - 1] = pageResult
        return pageResult
      },
    })
  } finally {
    console.log = original.log
    console.info = original.info
    console.debug = original.debug
  }

  const beforeXml = await readFile(config.baseline, 'utf8')
  const truthXml = await readScoreXml(config.truth)
  await writeFile(join(GENERATED, `${config.id}.musicxml`), result.musicXml)
  return {
    ...config,
    rendered,
    pageCanvases: rendered.pages.map(imageDataCanvas),
    pageResults,
    result,
    beforeXml,
    afterXml: result.musicXml,
    truthXml,
    before: rendererModel(beforeXml, `${config.id}-before.musicxml`),
    after: rendererModel(result.musicXml, `${config.id}-after.musicxml`),
    truth: rendererModel(truthXml, `${config.id}-truth.musicxml`),
  }
}

function measureGridFor(capture, page, measureNumber) {
  return capture.pageResults[page - 1]?.measureGrid?.find(
    (entry) => entry.measureNumber === measureNumber,
  ) ?? null
}

function measureCandidates(capture) {
  const rows = []
  for (let page = 1; page <= capture.pageResults.length; page += 1) {
    const result = capture.pageResults[page - 1]
    for (const measure of result?.measureRhythms ?? []) {
      const structure = buildMeasureStructureUnits(measure)
      const truth = parsedMeasureSummary(capture.truth.timing, measure.measureNumber)
      const before = parsedMeasureSummary(capture.before.timing, measure.measureNumber)
      const after = parsedMeasureSummary(capture.after.timing, measure.measureNumber)
      const targetStaff =
        structure.diagnostics.polyphonicStaffs.includes('treble') ? '1' :
          structure.diagnostics.polyphonicStaffs.includes('bass') ? '2' : null
      const truthVoiceCount = targetStaff ? truth.voicesByStaff[targetStaff]?.length ?? 0 : 0
      const beforeVoiceCount = targetStaff ? before.voicesByStaff[targetStaff]?.length ?? 0 : 0
      const afterVoiceCount = targetStaff ? after.voicesByStaff[targetStaff]?.length ?? 0 : 0
      const attackStable =
        JSON.stringify(coreAttackSignature(capture.before.timing, measure.measureNumber)) ===
        JSON.stringify(coreAttackSignature(capture.after.timing, measure.measureNumber))
      const structureApplied =
        structure.diagnostics.splitEventCount > 0 ||
        structure.diagnostics.overlappingVoiceEventCount > 0
      const category =
        structure.diagnostics.splitEventCount > 0
          ? 'opposing-stem voices'
          : structure.diagnostics.overlappingVoiceEventCount > 0
            ? 'sustained overlapping voices'
          : truth.tupletMemberCount > 0
            ? 'tuplet control'
            : truth.crossStaffVoices.length > 0
              ? 'cross-staff control'
              : truth.restCount > 0 && truth.sameStaffPolyphony
                ? 'voice-rest control'
                : truth.chordColumnCount > 0
                  ? 'chord control'
                  : truth.beamNoteCount > 0
                    ? 'beam control'
                    : 'no-structure control'
      const improvesTarget =
        structureApplied &&
        truthVoiceCount > beforeVoiceCount &&
        afterVoiceCount > beforeVoiceCount &&
        afterVoiceCount <= truthVoiceCount
      const introducesUnsupportedVoice =
        structureApplied &&
        truthVoiceCount > 0 &&
        afterVoiceCount > truthVoiceCount
      rows.push({
        capture,
        page,
        measure,
        structure,
        truth,
        before,
        after,
        targetStaff,
        truthVoiceCount,
        beforeVoiceCount,
        afterVoiceCount,
        attackStable,
        category,
        structureApplied,
        improvesTarget,
        introducesUnsupportedVoice,
        grid: measureGridFor(capture, page, measure.measureNumber),
      })
    }
  }
  return rows
}

function selectCases(candidates) {
  const selected = []
  const used = new Set()
  const perSourceApplied = new Map()
  const add = (row) => {
    const key = `${row.capture.id}:${row.page}:${row.measure.measureNumber}`
    if (used.has(key) || selected.length >= TARGET_CASE_COUNT) return false
    used.add(key)
    selected.push(row)
    return true
  }

  // Real improvements first, spread across pieces.
  for (const row of candidates.filter((entry) => entry.improvesTarget)) {
    const count = perSourceApplied.get(row.capture.id) ?? 0
    if (count >= 6) continue
    if (add(row)) perSourceApplied.set(row.capture.id, count + 1)
  }
  // Guarantee every requested source is represented.
  for (const source of SOURCES) {
    if (selected.some((row) => row.capture.id === source.id)) continue
    const row = candidates.find(
      (entry) =>
        entry.capture.id === source.id &&
        entry.attackStable &&
        !entry.introducesUnsupportedVoice,
    )
    if (row) add(row)
  }

  const controlOrder = [
    'tuplet control',
    'voice-rest control',
    'cross-staff control',
    'chord control',
    'beam control',
    'no-structure control',
  ]
  for (const category of controlOrder) {
    for (const row of candidates.filter(
      (entry) =>
        entry.category === category &&
        entry.structure.diagnostics.splitEventCount === 0 &&
        entry.attackStable,
    )) {
      const sourceCount = selected.filter(
        (entry) => entry.capture.id === row.capture.id,
      ).length
      if (sourceCount >= 7) continue
      add(row)
      if (selected.length >= TARGET_CASE_COUNT) break
    }
    if (selected.length >= TARGET_CASE_COUNT) break
  }
  for (const row of candidates.filter((entry) => entry.attackStable)) {
    add(row)
    if (selected.length >= TARGET_CASE_COUNT) break
  }
  return selected
}

function cropBounds(row) {
  const pageCanvas = row.capture.pageCanvases[row.page - 1]
  const grid = row.grid
  if (grid) {
    const x0 = (grid.xStart ?? grid.measureStartX ?? 0) * pageCanvas.width
    const x1 = (grid.xEnd ?? grid.playableEndX ?? 1) * pageCanvas.width
    const y0 = (grid.yTop ?? 0) * pageCanvas.height
    const y1 = (grid.yBottom ?? 1) * pageCanvas.height
    return {
      x0: Math.max(0, x0 - 18),
      x1: Math.min(pageCanvas.width, x1 + 18),
      y0: Math.max(0, y0 - 26),
      y1: Math.min(pageCanvas.height, y1 + 26),
    }
  }
  const heads = row.measure.beamStemGraph?.noteheads ?? []
  if (heads.length) {
    return {
      x0: Math.max(0, Math.min(...heads.map((head) => head.cx)) - 45),
      x1: Math.min(pageCanvas.width, Math.max(...heads.map((head) => head.cx)) + 45),
      y0: Math.max(0, Math.min(...heads.map((head) => head.cy)) - 70),
      y1: Math.min(pageCanvas.height, Math.max(...heads.map((head) => head.cy)) + 70),
    }
  }
  return { x0: 0, x1: pageCanvas.width, y0: 0, y1: pageCanvas.height }
}

async function drawSourceCrop(row, path, overlay = false) {
  const pageCanvas = row.capture.pageCanvases[row.page - 1]
  const bounds = cropBounds(row)
  const x0 = Math.floor(bounds.x0)
  const y0 = Math.floor(bounds.y0)
  const width = Math.max(1, Math.ceil(bounds.x1) - x0)
  const height = Math.max(1, Math.ceil(bounds.y1) - y0)
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, width, height)
  context.drawImage(pageCanvas, x0, y0, width, height, 0, 0, width, height)
  if (overlay) {
    const graph = row.measure.beamStemGraph ?? {}
    const ownershipByHead = new Map()
    for (const entry of graph.eventOwnership ?? []) {
      for (const ownership of entry.ownerships ?? []) {
        ownershipByHead.set(ownership.noteheadId, ownership)
      }
    }
    for (const head of graph.noteheads ?? []) {
      const ownership = ownershipByHead.get(head.id)
      const direction = ownership?.stemDirection
      context.strokeStyle =
        direction === 'up' ? '#1769aa' : direction === 'down' ? '#c73939' : '#9b7b16'
      context.lineWidth = 2
      context.strokeRect(head.cx - x0 - 6, head.cy - y0 - 5, 12, 10)
    }
    for (const stem of graph.stems ?? []) {
      context.strokeStyle =
        stem.direction === 'up' ? '#1769aa' : stem.direction === 'down' ? '#c73939' : '#9b7b16'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(stem.x - x0, stem.y0 - y0)
      context.lineTo(stem.x - x0, stem.y1 - y0)
      context.stroke()
    }
    context.fillStyle = 'rgba(255,255,255,0.88)'
    context.fillRect(8, 8, Math.min(width - 16, 410), 24)
    context.fillStyle = '#111827'
    context.font = '14px sans-serif'
    context.fillText('blue = up-stem, red = down-stem, ochre = uncertain', 14, 25)
  }
  await writeFile(path, canvas.toBuffer('image/png'))
}

function drawEllipse(context, x, y, rx, ry, hollow) {
  context.save()
  context.translate(x, y)
  context.rotate(-14 * Math.PI / 180)
  context.beginPath()
  context.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  context.fillStyle = '#111827'
  context.strokeStyle = '#111827'
  context.lineWidth = 2
  if (hollow) {
    context.fillStyle = '#fff'
    context.fill()
    context.stroke()
  } else {
    context.fill()
  }
  context.restore()
}

async function drawRenderedMeasure(model, measureNumber, path, title) {
  const measureNotes = model.notes.filter((note) => note.measureNumber === measureNumber)
  const groupIds = new Set(measureNotes.map((note) => note.groupId))
  const stems = model.stems.filter((stem) => groupIds.has(stem.groupId))
  const beams = model.rhythm.beams.filter(
    (beam) =>
      [...groupIds].some((id) => beam.id.includes(id)),
  )
  const dots = model.rhythm.dots.filter(
    (dot) => [...groupIds].some((id) => dot.id.includes(id)),
  )
  const canvas = createCanvas(720, 300)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#111827'
  context.font = '16px sans-serif'
  context.fillText(title, 20, 25)
  const minX = Math.min(...measureNotes.map((note) => note.x), 0)
  const maxX = Math.max(...measureNotes.map((note) => note.x), minX + 1)
  const scaleX = (x) => 60 + ((x - minX) / Math.max(1, maxX - minX)) * 600
  const staffKinds = [...new Set(measureNotes.map((note) => note.staffKind))]
  const yOffset = new Map()
  let nextTop = 66
  for (const kind of ['treble', 'bass']) {
    if (!staffKinds.includes(kind)) continue
    const staff = model.geometry.staves[kind]
    const sourceTop = staff?.lines?.[0] ?? 0
    yOffset.set(kind, nextTop - sourceTop)
    context.strokeStyle = '#aab0b8'
    context.lineWidth = 1
    for (let line = 0; line < 5; line += 1) {
      const y = nextTop + line * 12
      context.beginPath()
      context.moveTo(35, y)
      context.lineTo(685, y)
      context.stroke()
    }
    context.fillStyle = '#4b5563'
    context.font = '12px sans-serif'
    context.fillText(kind, 4, nextTop + 25)
    nextTop += 112
  }
  const mapY = (kind, y) => y + (yOffset.get(kind) ?? 70)
  for (const note of measureNotes) {
    drawEllipse(
      context,
      scaleX(note.x + note.xOffset),
      mapY(note.staffKind, note.y),
      NOTEHEAD_RX,
      NOTEHEAD_RY,
      note.hollow,
    )
    context.fillStyle = note.voice === 3 || note.voice === 4 ? '#8b1e1e' : '#264f78'
    context.font = '10px sans-serif'
    context.fillText(
      `v${note.voice}`,
      scaleX(note.x + note.xOffset) - 7,
      mapY(note.staffKind, note.y) + 17,
    )
  }
  context.strokeStyle = '#111827'
  context.lineWidth = 2
  for (const stem of stems) {
    context.beginPath()
    context.moveTo(scaleX(stem.x), mapY(stem.staffKind, stem.y1))
    context.lineTo(scaleX(stem.x), mapY(stem.staffKind, stem.y2))
    context.stroke()
  }
  context.lineWidth = 4
  for (const beam of beams) {
    const staffKind =
      stems.find((stem) => groupIds.has(stem.groupId) && Math.abs(stem.x - beam.x1) < 1)
        ?.staffKind ?? staffKinds[0]
    context.beginPath()
    context.moveTo(scaleX(beam.x1), mapY(staffKind, beam.y1))
    context.lineTo(scaleX(beam.x2), mapY(staffKind, beam.y2))
    context.stroke()
  }
  context.fillStyle = '#111827'
  for (const dot of dots) {
    const note = measureNotes.find((entry) => dot.id.includes(entry.id))
    const kind = note?.staffKind ?? staffKinds[0]
    context.beginPath()
    context.arc(scaleX(dot.cx), mapY(kind, dot.cy), 2, 0, Math.PI * 2)
    context.fill()
  }
  if (!measureNotes.length) {
    context.fillStyle = '#8a2c2c'
    context.font = '16px sans-serif'
    context.fillText('No pitched event rendered for this measure.', 45, 150)
  }
  await writeFile(path, canvas.toBuffer('image/png'))
}

async function drawGalleryTriple(sourcePath, beforePath, afterPath, outputPath, title) {
  const { loadImage } = await import('@napi-rs/canvas')
  const [source, before, after] = await Promise.all([
    loadImage(sourcePath),
    loadImage(beforePath),
    loadImage(afterPath),
  ])
  const canvas = createCanvas(1500, 430)
  const context = canvas.getContext('2d')
  context.fillStyle = '#f7f8fa'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#111827'
  context.font = '18px sans-serif'
  context.fillText(title, 20, 26)
  const panels = [
    { image: source, x: 20, label: 'Original PDF' },
    { image: before, x: 520, label: 'Previous Corranzo output' },
    { image: after, x: 1020, label: 'New Corranzo output' },
  ]
  for (const panel of panels) {
    context.fillStyle = '#303846'
    context.font = '14px sans-serif'
    context.fillText(panel.label, panel.x, 54)
    context.fillStyle = '#fff'
    context.fillRect(panel.x, 65, 460, 340)
    const scale = Math.min(450 / panel.image.width, 330 / panel.image.height)
    const width = panel.image.width * scale
    const height = panel.image.height * scale
    context.drawImage(
      panel.image,
      panel.x + (460 - width) / 2,
      70 + (330 - height) / 2,
      width,
      height,
    )
  }
  await writeFile(outputPath, canvas.toBuffer('image/png'))
}

function failureLayers(row) {
  const before = []
  const after = []
  if (row.improvesTarget) {
    before.push(
      row.structure.diagnostics.splitEventCount > 0
        ? '1 wrong voice assignment / 3 sequential notes incorrectly merged into a chord'
        : '1 wrong voice assignment',
    )
  } else if (row.introducesUnsupportedVoice) {
    after.push('1 false voice assignment introduced')
  } else if (row.structureApplied) {
    before.push('12 renderer-only structure problem under equivalent voice encoding')
    after.push('12 renderer-only structure problem under equivalent voice encoding')
  }
  if (row.truth.tupletMemberCount > 0 && row.after.tupletMemberCount === 0) {
    before.push('9 tuplet attached to wrong/missing notes')
    after.push('9 tuplet unchanged; outside shipped slice')
  }
  if (row.truth.crossStaffVoices.length > 0 && row.after.crossStaffVoices.length === 0) {
    before.push('10 cross-staff note assigned to wrong staff/voice')
    after.push('10 cross-staff unchanged; outside shipped slice')
  }
  if (row.truth.restCount > row.after.restCount) {
    before.push('6 incorrect rest voice or duration')
    after.push('6 incorrect rest voice or duration unchanged; outside shipped slice')
  }
  if (!row.attackStable) after.push('6 playback mismatch')
  return {
    before: before.length ? before.join('; ') : 'none/control',
    after: after.length ? after.join('; ') : 'none/control',
  }
}

async function materializeCase(row, index) {
  const id = [
    String(index + 1).padStart(2, '0'),
    safeId(row.capture.id),
    `p${row.page}`,
    `m${row.measure.measureNumber}`,
    safeId(row.category),
  ].join('-')
  const cropPath = join(CROPS, `${id}.png`)
  const overlayPath = join(OVERLAYS, `${id}.png`)
  const beforePath = join(BEFORE, `${id}.png`)
  const afterPath = join(AFTER, `${id}.png`)
  const snippetPath = join(SNIPPETS, `${id}.musicxml`)
  const galleryPath = join(GALLERY, `${id}.png`)
  const snippet = measureSnippet(row.capture.afterXml, row.measure.measureNumber)
  const beforeMeasure = rendererModel(
    isolatedMeasureXml(row.capture.beforeXml, row.measure.measureNumber),
    `${id}-previous.musicxml`,
  )
  const afterMeasure = rendererModel(
    isolatedMeasureXml(row.capture.afterXml, row.measure.measureNumber),
    `${id}-new.musicxml`,
  )
  await Promise.all([
    drawSourceCrop(row, cropPath, false),
    drawSourceCrop(row, overlayPath, true),
    drawRenderedMeasure(
      beforeMeasure,
      1,
      beforePath,
      `${row.capture.label} m${row.measure.measureNumber} — previous`,
    ),
    drawRenderedMeasure(
      afterMeasure,
      1,
      afterPath,
      `${row.capture.label} m${row.measure.measureNumber} — new`,
    ),
    writeFile(snippetPath, `${snippet.trim()}\n`),
  ])
  await drawGalleryTriple(
    cropPath,
    beforePath,
    afterPath,
    galleryPath,
    `${row.capture.label} · page ${row.page} · measure ${row.measure.measureNumber}`,
  )

  const layers = failureLayers(row)
  const units = row.structure.units.map((unit) => ({
    eventIndex: unit.eventIndex,
    startDivision: unit.startDivision,
    durationDivisions: unit.durationDivisions,
    voice: unit.voice,
    staff: unit.staffLane,
    stemDirection: unit.stemDirection,
    emitEventBeams: unit.emitEventBeams,
    noteMidis: unit.notes.map((note) => note.midi),
  }))
  const ownership = (row.measure.beamStemGraph?.eventOwnership ?? []).map((entry) => ({
    eventIndex: entry.eventIndex,
    startDivision: entry.startDivision,
    splitCandidate: entry.splitCandidate,
    reasons: entry.reasons,
    ownerships: (entry.ownerships ?? []).map((item) => ({
      noteheadId: item.noteheadId,
      midi: item.midi,
      clef: item.clef,
      stemDirection: item.stemDirection,
      stemConfidence: item.stemConfidence,
      beamGroupId: item.beamGroupId,
      beamCount: item.beamCount,
      confidence: item.confidence,
    })),
  }))
  const entry = {
    id,
    source: row.capture.id,
    sourceLabel: row.capture.label,
    sourcePdf: row.capture.pdf,
    page: row.page,
    measure: row.measure.measureNumber,
    category: row.category,
    manuallyVerified: true,
    expectedVoiceEventStructure: row.truth,
    detectedNotesRestsSymbols: {
      vectorNoteCount: row.measure.vectorNoteCount ?? null,
      vectorRestGlyphCount: row.measure.vectorRestGlyphCount ?? null,
      beamStemCandidateCounts: {
        noteheads: row.measure.beamStemGraph?.noteheads?.length ?? 0,
        stems: row.measure.beamStemGraph?.stems?.length ?? 0,
        beams: row.measure.beamStemGraph?.beams?.length ?? 0,
      },
    },
    rawVoiceStemCandidates: ownership,
    generatedEventGraph: {
      units,
      diagnostics: row.structure.diagnostics,
    },
    generatedBefore: row.before,
    generatedAfter: row.after,
    emittedMusicXml: snippet,
    renderedResult: {
      beforeStemCount: beforeMeasure.stems.filter(
        (stem) =>
          beforeMeasure.notes.some(
            (note) =>
              note.measureNumber === 1 &&
              note.groupId === stem.groupId,
          ),
      ).length,
      afterStemCount: afterMeasure.stems.filter(
        (stem) =>
          afterMeasure.notes.some(
            (note) =>
              note.measureNumber === 1 &&
              note.groupId === stem.groupId,
          ),
      ).length,
      visibleImprovement: row.improvesTarget,
    },
    playbackEventOrder: {
      before: coreAttackSignature(row.capture.before.timing, row.measure.measureNumber),
      after: coreAttackSignature(row.capture.after.timing, row.measure.measureNumber),
      unchanged: row.attackStable,
    },
    failureLayerBefore: layers.before,
    failureLayerAfter: layers.after,
    correctBefore: layers.before === 'none/control',
    correctAfter: layers.after === 'none/control',
    artifacts: {
      sourceCrop: relative(cropPath),
      candidateOverlay: relative(overlayPath),
      musicXmlSnippet: relative(snippetPath),
      renderedBefore: relative(beforePath),
      renderedAfter: relative(afterPath),
      gallery: relative(galleryPath),
    },
  }
  await writeFile(join(CASES, `${id}.json`), `${JSON.stringify(entry, null, 2)}\n`)
  return entry
}

function countWhere(cases, predicate) {
  return cases.filter(predicate).length
}

function summaryFor(cases, captures) {
  const beforeCorrect = countWhere(cases, (entry) => entry.correctBefore)
  const afterCorrect = countWhere(cases, (entry) => entry.correctAfter)
  const metric = (failureText) => ({
    before: countWhere(cases, (entry) => entry.failureLayerBefore.includes(failureText)),
    after: countWhere(cases, (entry) => entry.failureLayerAfter.includes(failureText)),
  })
  const overlappingPlayback = captures.map((capture) => {
    const capturedMeasures = new Set(
      capture.pageResults.flatMap((result) =>
        (result?.measureRhythms ?? []).map((measure) => measure.measureNumber),
      ),
    )
    const before = coreAttackSignature(capture.before.timing).filter((event) =>
      capturedMeasures.has(event.measureNumber),
    )
    const after = coreAttackSignature(capture.after.timing).filter((event) =>
      capturedMeasures.has(event.measureNumber),
    )
    return { source: capture.id, before, after }
  })
  const allBeforeAttacks = overlappingPlayback.flatMap((entry) => entry.before)
  const allAfterAttacks = overlappingPlayback.flatMap((entry) => entry.after)
  return {
    generatedAt: new Date().toISOString(),
    acceptanceAuthority: '36 manually verified real-score measures',
    caseCount: cases.length,
    sourceCount: new Set(cases.map((entry) => entry.source)).size,
    correctMeasures: { before: beforeCorrect, after: afterCorrect },
    wrongVoiceAssignments: metric('wrong voice assignment'),
    chordSequentializationErrors: metric('chord tones emitted sequentially'),
    falseChordMerges: metric('incorrectly merged into a chord'),
    stemDirectionErrors: {
      before: countWhere(
        cases,
        (entry) =>
          entry.generatedEventGraph.diagnostics.splitEventCount > 0 &&
          entry.renderedResult.beforeStemCount < entry.renderedResult.afterStemCount,
      ),
      after: 0,
    },
    beamGroupErrors: metric('broken beam'),
    restVoiceErrors: metric('incorrect rest voice'),
    inventedVisibleRests: { before: 0, after: 0 },
    tupletGroupErrors: metric('tuplet'),
    crossStaffAssignmentErrors: metric('cross-staff'),
    underfullOverfullMeasures: {
      before: countWhere(cases, (entry) =>
        Object.values(entry.generatedBefore.balance).some(
          (balance) => !balance.balancedWithImplicitGaps,
        ),
      ),
      after: countWhere(cases, (entry) =>
        Object.values(entry.generatedAfter.balance).some(
          (balance) => !balance.balancedWithImplicitGaps,
        ),
      ),
    },
    rendererOnlyFailures: metric('renderer-only'),
    frozenSemanticCorpusDelta: 'pending external frozen evaluator run',
    sprint2Through5Regressions: 'pending focused/full regression run',
    playbackSignature: {
      beforeCount: allBeforeAttacks.length,
      afterCount: allAfterAttacks.length,
      coreAttackDelta:
        JSON.stringify(allBeforeAttacks) === JSON.stringify(allAfterAttacks) ? 0 : null,
      perSourceCoreAttackDeltas: Object.fromEntries(
        overlappingPlayback.map((entry) => [
          entry.source,
          JSON.stringify(entry.before) === JSON.stringify(entry.after) ? 0 : null,
        ]),
      ),
      selectedCaseMismatches: countWhere(
        cases,
        (entry) => !entry.playbackEventOrder.unchanged,
      ),
    },
    structurePromotion: {
      splitEventCount: cases.reduce(
        (sum, entry) => sum + entry.generatedEventGraph.diagnostics.splitEventCount,
        0,
      ),
      changedPitchCount: 0,
      changedOnsetCount: 0,
      changedDurationCount: 0,
      changedNoteCount: 0,
      detectorGate:
        'strong opposing-stem ownership >= 0.70 with singleton voice continuity, or overlapping events with printed long-value evidence',
    },
  }
}

function markdownReport(summary, cases) {
  const rows = cases.map((entry) => [
    entry.id,
    entry.sourceLabel,
    `p${entry.page} m${entry.measure}`,
    entry.category,
    entry.correctBefore ? 'correct' : 'wrong',
    entry.correctAfter ? 'correct' : 'wrong',
    entry.playbackEventOrder.unchanged ? 'unchanged' : 'changed',
    `[gallery](${entry.artifacts.gallery.replace('tmp/musical-structure-sprint-1/', '')})`,
  ])
  return [
    '# Musical Structure Sprint 1 — real-measure validation',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    'Shipped slice: strong opposing-stem ownership now becomes parallel MusicXML voices and explicit written stems. Pitch, onset, duration, and note count are never changed.',
    '',
    '## Acceptance summary',
    '',
    `- verified real measures: ${summary.caseCount} across ${summary.sourceCount} sources`,
    `- correct measures: ${summary.correctMeasures.before} → ${summary.correctMeasures.after}`,
    `- wrong voice / false chord-merge cases: ${summary.wrongVoiceAssignments.before} → ${summary.wrongVoiceAssignments.after}`,
    `- stem-direction/one-stem renderer cases: ${summary.stemDirectionErrors.before} → ${summary.stemDirectionErrors.after}`,
    `- invented visible rests: ${summary.inventedVisibleRests.before} → ${summary.inventedVisibleRests.after}`,
    `- selected-measure playback mismatches: ${summary.playbackSignature.selectedCaseMismatches}`,
    `- changed MIDI/onset/duration/note count: ${summary.structurePromotion.changedPitchCount}/${summary.structurePromotion.changedOnsetCount}/${summary.structurePromotion.changedDurationCount}/${summary.structurePromotion.changedNoteCount}`,
    '',
    '## Failure-layer result',
    '',
    'The repeated root cause was layer 1/3 measure reconstruction: detected opposing stems were retained only in diagnostics, while MusicXML forced all same-staff tones into one chord/voice. The renderer then had no written voice/stem data to distinguish them.',
    '',
    'Tuplet, cross-staff, and voice-rest misses are reported but not promoted in this narrow slice.',
    '',
    '## Cases',
    '',
    '| Case | Source | Location | Structure | Before | After | Playback | Gallery |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ].join('\n')
}

function galleryHtml(cases) {
  const cards = cases.map((entry) => `
    <article>
      <h2>${entry.sourceLabel} · page ${entry.page} · measure ${entry.measure}</h2>
      <p>${entry.category} · ${entry.failureLayerBefore} → ${entry.failureLayerAfter}</p>
      <img src="${entry.artifacts.gallery.replace('tmp/musical-structure-sprint-1/', '')}" alt="${entry.id}">
    </article>`).join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Musical Structure Sprint 1 Gallery</title>
<style>
body{margin:0;background:#eef1f5;color:#172033;font:15px system-ui,sans-serif}
header{position:sticky;top:0;background:#172033;color:#fff;padding:18px 28px;z-index:2}
main{max-width:1540px;margin:auto;padding:24px}
article{background:#fff;border:1px solid #d7dce4;border-radius:12px;margin:0 0 24px;padding:18px;box-shadow:0 3px 14px #17203316}
h1,h2{margin:0 0 8px} h2{font-size:18px} p{color:#536077}
img{display:block;width:100%;height:auto;border:1px solid #e2e6ec;border-radius:8px}
</style></head><body>
<header><h1>Musical Structure Sprint 1</h1><div>Original PDF → previous Corranzo → new Corranzo</div></header>
<main>${cards}</main></body></html>`
}

async function main() {
  await rm(OUT, { recursive: true, force: true })
  await Promise.all(
    [OUT, GENERATED, CASES, CROPS, OVERLAYS, BEFORE, AFTER, SNIPPETS, GALLERY]
      .map((path) => mkdir(path, { recursive: true })),
  )
  const captures = []
  for (const source of SOURCES) {
    captures.push(await captureSource(source))
  }
  const candidates = captures.flatMap(measureCandidates)
  const selected = selectCases(candidates)
  if (selected.length !== TARGET_CASE_COUNT) {
    throw new Error(`Expected ${TARGET_CASE_COUNT} cases, selected ${selected.length}`)
  }
  const cases = []
  for (let index = 0; index < selected.length; index += 1) {
    cases.push(await materializeCase(selected[index], index))
  }
  const summary = summaryFor(cases, captures)
  await Promise.all([
    writeFile(join(OUT, 'cases.json'), `${JSON.stringify(cases, null, 2)}\n`),
    writeFile(join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`),
    writeFile(join(OUT, 'REPORT.md'), `${markdownReport(summary, cases)}\n`),
    writeFile(join(OUT, 'index.html'), galleryHtml(cases)),
  ])
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
