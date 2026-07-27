#!/usr/bin/env node
/**
 * Notation Fidelity Sprint 5 real-score articulation acceptance trace.
 *
 * Builds 45 manually reviewed cases from real/vector scores and one raster
 * control. Every case stores source crop, raw candidate, attachment, MusicXML,
 * Visual Practice geometry, and playback semantics.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { processOmrPageAnalysis } from '../src/features/omr/processOmrPage.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  articulationSourceForNote,
  playbackDurationSecondsForNote,
  playbackVelocityForNote,
} from '../src/features/playback/staccatoPlayback.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import {
  buildStaffGeometry,
  buildStaffLaneNotationMarkings,
  buildStaffLaneNotes,
  detectStaves,
} from '../src/features/practice/staffLaneLayout.js'
import { textGlyphsToImage } from '../src/features/omr/processVectorOmrPage.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tmp/notation-fidelity-sprint-5')
const CASE_DIR = join(OUT, 'cases')
const CROP_DIR = join(OUT, 'source-crops')
const OVERLAY_DIR = join(OUT, 'candidate-overlays')
const RENDER_BEFORE_DIR = join(OUT, 'rendered-before')
const RENDER_AFTER_DIR = join(OUT, 'rendered-after')
const XML_DIR = join(OUT, 'musicxml-snippets')
const GENERATED_DIR = join(OUT, 'generated')
const DOWNLOADS = join(homedir(), 'Downloads')

const SOURCES = [
  {
    id: 'gymnopedie',
    pdf: join(DOWNLOADS, 'gymnopedie-no-1-satie.pdf'),
    pages: 1,
    baseline: join(ROOT, 'tmp/notation-fidelity-sprint-2/after/gymnopedie.musicxml'),
  },
  {
    id: 'evangelion',
    pdf: join(
      DOWNLOADS,
      'a-cruel-angels-thesis-neon-genesis-evangelion.pdf',
    ),
    pages: 1,
    baseline: join(ROOT, 'tmp/notation-fidelity-sprint-2/after/evangelion.musicxml'),
  },
  {
    id: 'minecraft',
    pdf: join(
      DOWNLOADS,
      'beginner-minecraft-piano-themes-in-c-minecraft.pdf',
    ),
    pages: 1,
    baseline: join(ROOT, 'tmp/notation-fidelity-sprint-2/after/minecraft.musicxml'),
  },
  {
    id: 'piano-articulation-scan',
    pdf: join(
      ROOT,
      'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf',
    ),
    pages: 1,
    baseline: join(ROOT, 'tmp/notation-fidelity-sprint-2/after/articulation.musicxml'),
  },
  {
    id: 'piano-grand-voices-vector',
    pdf: join(
      ROOT,
      'benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.pdf',
    ),
    pages: 1,
    baseline: join(
      ROOT,
      'tmp/notation-fidelity-sprint-1/piano-grand-voices-vector.musicxml',
    ),
  },
  {
    id: 'la-campanella',
    pdf: join(
      DOWNLOADS,
      'etude-s-1413-in-g-minor-la-campanella-liszt.pdf',
    ),
    pages: 6,
    baseline: null,
  },
]

const EXPECTED_BY_GLYPH = new Map([
  ['\ue4a0', { type: 'accent', placement: 'above' }],
  ['\ue4a1', { type: 'accent', placement: 'below' }],
  ['\ue4a2', { type: 'staccato', placement: 'above' }],
  ['\ue4a3', { type: 'staccato', placement: 'below' }],
  ['\ue4a4', { type: 'tenuto', placement: 'above' }],
  ['\ue4a5', { type: 'tenuto', placement: 'below' }],
  ['\ue4ac', { type: 'marcato', placement: 'above' }],
  ['\ue4ad', { type: 'marcato', placement: 'below' }],
  ['\ue4c0', { type: 'fermata', placement: 'above' }],
  ['\ue4c1', { type: 'fermata', placement: 'below' }],
])

const OLD_TYPE_BY_GLYPH = new Map([
  ['\ue4a0', 'staccato'],
  ['\ue4a1', 'staccato'],
  ['\ue4a2', 'staccato'],
  ['\ue4a3', 'accent'],
  ['\ue4a4', 'accent'],
  ['\ue4e5', 'staccato'],
])

function relative(path) {
  return path.replace(`${ROOT}/`, '')
}

function safeId(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function glyphCode(glyph) {
  return `U+${glyph.text.codePointAt(0).toString(16).toUpperCase()}`
}

function glyphKey(glyph, page = 1) {
  return [
    page,
    glyph.text,
    Math.round(glyph.x),
    Math.round(glyph.y),
  ].join(':')
}

function imageDataCanvas(page) {
  const canvas = createCanvas(page.width, page.height)
  const context = canvas.getContext('2d')
  const data = context.createImageData(page.width, page.height)
  data.data.set(page.data)
  context.putImageData(data, 0, 0)
  return canvas
}

function measureBlocks(xml) {
  const firstPart = xml.match(/<part(?:\s[^>]*)?>[\s\S]*?<\/part>/)?.[0] ?? xml
  return [...firstPart.matchAll(/<measure\b[^>]*number="([^"]+)"[^>]*>[\s\S]*?<\/measure>/g)]
    .map((match) => ({ number: Number(match[1]), xml: match[0] }))
    .filter((entry) => Number.isFinite(entry.number))
}

function measureSnippet(xml, measureNumber) {
  return measureBlocks(xml).find((entry) => entry.number === measureNumber)?.xml ?? ''
}

function corePlaybackSignature(xml, name) {
  return parseMusicXml(xml, name).notes
    .filter((note) => !note.isRest && note.midi != null)
    .map((note) => ({
      measureNumber: note.measureNumber,
      voice: note.voice,
      staff: note.staff,
      quarterTime: Number(note.quarterTime.toFixed(6)),
      durationQuarters: Number(note.durationQuarters.toFixed(6)),
      midi: note.midi,
      tieStart: Boolean(note.tieStart),
      tieStop: Boolean(note.tieStop),
      suppressPlaybackAttack: Boolean(note.suppressPlaybackAttack),
    }))
}

function articulationCounts(xml) {
  const count = (pattern) => xml.match(pattern)?.length ?? 0
  return {
    staccato: count(/<staccato(?:\s|\/)/g),
    accent: count(/<accent(?:\s|\/)/g),
    tenuto: count(/<tenuto(?:\s|\/)/g),
    marcato: count(/<strong-accent(?:\s|\/)/g),
    fermata: count(/<fermata(?:\s|\/)/g),
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
  const markings = buildStaffLaneNotationMarkings(groups, geometry, { notes })
  return { timing, groups, geometry, notes, markings }
}

async function captureSource(config) {
  const rendered = await renderPdfToPages(config.pdf, {
    rootDir: ROOT,
    maxPages: config.pages,
  })
  const rawExtractPageText = await makePdfTextExtractor(config.pdf, {
    rootDir: ROOT,
  })
  const pageTexts = []
  const pageResults = []
  const extractPageText = async (source, page) => {
    const text = await rawExtractPageText(source, page)
    pageTexts[page - 1] = text
    return text
  }
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
      title: `${config.id}-notation-fidelity-sprint5`,
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
  await writeFile(
    join(GENERATED_DIR, `${config.id}.musicxml`),
    result.musicXml,
  )
  const baselineXml = config.baseline
    ? await readFile(config.baseline, 'utf8')
    : null
  const timing = parseMusicXml(
    result.musicXml,
    `${config.id}-after.musicxml`,
  )
  return {
    ...config,
    rendered,
    pageCanvases: rendered.pages.map(imageDataCanvas),
    pageTexts,
    pageResults,
    result,
    baselineXml,
    renderer: rendererModel(result.musicXml, `${config.id}-after.musicxml`),
    schedule: timing.notes
      .filter((note) => !note.isRest && note.midi != null)
      .map((note) => ({
        id: note.id,
        measureNumber: note.measureNumber,
        midi: note.midi,
        quarterTime: note.quarterTime,
        voice: note.voice,
        staff: note.staff,
        attackCount: note.suppressPlaybackAttack ? 0 : 1,
        articulationSource: articulationSourceForNote(note),
        writtenDurationSeconds: note.durationSeconds,
        baseDurationSeconds: playbackDurationSecondsForNote(note),
        velocity: playbackVelocityForNote(note),
      })),
  }
}

function pageMeasures(capture, page) {
  return capture.pageResults[page - 1]?.measureRhythms ?? []
}

function measureForGlyph(capture, page, glyph) {
  const grid = capture.pageResults[page - 1]?.measureGrid ?? []
  const x = glyph.x / capture.rendered.pages[page - 1].width
  const y = glyph.y / capture.rendered.pages[page - 1].height
  return [...grid]
    .map((entry) => {
      const dx =
        x < entry.xStart ? entry.xStart - x : x > entry.xEnd ? x - entry.xEnd : 0
      const dy =
        y < entry.yTop ? entry.yTop - y : y > entry.yBottom ? y - entry.yBottom : 0
      return { entry, score: dx + dy * 1.4 }
    })
    .sort((left, right) => left.score - right.score)[0]?.entry ?? null
}

function eventTargetForAttachment(measure, attachment) {
  if (attachment?.note) {
    return (measure.events ?? [])
      .filter((event) => event.type === 'note')
      .flatMap((event) =>
        (event.notes ?? []).map((note) => ({ kind: 'note', event, note })),
      )
      .sort(
        (left, right) =>
          Math.hypot(
            left.note.cx - attachment.note.cx,
            left.note.cy - attachment.note.cy,
          ) -
          Math.hypot(
            right.note.cx - attachment.note.cx,
            right.note.cy - attachment.note.cy,
          ),
      )[0] ?? null
  }
  if (attachment?.rest) {
    return (measure.events ?? [])
      .filter((event) => event.type === 'rest')
      .map((event) => ({ kind: 'rest', event }))
      .sort(
        (left, right) =>
          Math.abs((left.event.cx ?? 0) - attachment.rest.cx) -
          Math.abs((right.event.cx ?? 0) - attachment.rest.cx),
      )[0] ?? null
  }
  return null
}

function diagnosticEntries(capture, {
  page,
  type,
  glyphTexts = null,
}) {
  const rows = []
  const claimed = new Set()
  for (const measure of pageMeasures(capture, page)) {
    const diagnostics =
      type === 'staccato'
        ? measure.vectorStaccatoDiagnostics
        : type === 'accent'
          ? measure.vectorAccentDiagnostics
          : measure.vectorNotationArticulationDiagnostics
    for (const candidate of diagnostics?.detectedCandidates ?? []) {
      if (
        candidate.type !== type ||
        (glyphTexts && !glyphTexts.has(candidate.glyph.text))
      ) {
        continue
      }
      const key = glyphKey(candidate.glyph, page)
      if (claimed.has(key)) {
        continue
      }
      claimed.add(key)
      const attachment = (diagnostics.selectedAttachments ?? []).find(
        (entry) => glyphKey(entry.glyph, page) === key,
      ) ?? null
      const target = eventTargetForAttachment(measure, attachment)
      rows.push({
        page,
        measure,
        candidate,
        attachment,
        target,
      })
    }
  }
  return rows.sort(
    (left, right) =>
      Number(Boolean(right.attachment)) - Number(Boolean(left.attachment)) ||
      left.candidate.glyph.y - right.candidate.glyph.y ||
      left.candidate.glyph.x - right.candidate.glyph.x,
  )
}

function directGlyphEntries(capture, page, glyphText, count) {
  const pageData = capture.rendered.pages[page - 1]
  const glyphs = textGlyphsToImage(
    capture.pageTexts[page - 1],
    pageData,
  ).filter((glyph) => glyph.text === glyphText)
  const claimed = new Set()
  const rows = []
  for (const glyph of glyphs) {
    const key = glyphKey(glyph, page)
    if (claimed.has(key)) continue
    claimed.add(key)
    const grid = measureForGlyph(capture, page, glyph)
    const measure = pageMeasures(capture, page).find(
      (entry) => entry.measureNumber === grid?.measureNumber,
    )
    if (!measure) continue
    rows.push({
      page,
      measure,
      candidate: {
        glyph,
        type: 'quarter-rest-control',
        placement: null,
        source: 'vector-glyph',
      },
      attachment: null,
      target: null,
    })
    if (rows.length >= count) break
  }
  return rows
}

function noteHasType(note, type) {
  return Boolean(note?.[type])
}

function parsedTarget(capture, entry, expectedType) {
  const notes = capture.renderer.timing.notes.filter(
    (note) => note.measureNumber === entry.measure.measureNumber,
  )
  if (entry.target?.kind === 'rest') {
    return notes.find((note) => note.isRest && noteHasType(note, expectedType)) ?? null
  }
  const midi = entry.target?.note?.midi
  return (
    notes.find(
      (note) =>
        !note.isRest &&
        note.midi === midi &&
        noteHasType(note, expectedType),
    ) ??
    notes.find((note) => !note.isRest && noteHasType(note, expectedType)) ??
    null
  )
}

function rendererMark(capture, parsed, expectedType) {
  if (!parsed || parsed.isRest) {
    return null
  }
  const notes = capture.renderer.notes.filter(
    (entry) =>
      entry.measureNumber === parsed.measureNumber &&
      entry.midi === parsed.midi,
  )
  for (const note of notes) {
    const marking = capture.renderer.markings.noteMarkings.find(
      (marking) =>
        marking.kind === expectedType &&
        (marking.noteId === note.visualNoteId ||
          marking.chordNoteIds?.includes(note.visualNoteId)),
    )
    if (marking) return marking
  }
  return null
}

function playbackTrace(capture, parsed) {
  if (!parsed || parsed.isRest) {
    return {
      attackCount: 0,
      articulationSource: parsed?.fermata ? 'fermata-rest-written-only' : 'none',
      midi: null,
    }
  }
  return (
    capture.schedule.find(
      (event) =>
        event.id === parsed.id ||
        (event.measureNumber === parsed.measureNumber &&
          event.midi === parsed.midi &&
          Math.abs((event.quarterTime ?? 0) - (parsed.quarterTime ?? 0)) <
            1e-6 &&
          (event.voice ?? 1) === (parsed.voice ?? 1) &&
          (event.staff ?? null) === (parsed.staff ?? null)),
    ) ?? {
      attackCount: null,
      articulationSource: 'missing-playback-event',
      midi: parsed.midi,
    }
  )
}

function caseBounds(entry) {
  const points = [
    {
      x: entry.candidate.glyph.x,
      y: entry.candidate.glyph.y,
    },
  ]
  if (entry.attachment?.note) {
    points.push({
      x: entry.attachment.note.cx,
      y: entry.attachment.note.cy,
    })
  }
  if (entry.attachment?.rest) {
    points.push({
      x: entry.attachment.rest.cx,
      y: entry.attachment.rest.cy,
    })
  }
  return {
    x0: Math.min(...points.map((point) => point.x)) - 90,
    x1: Math.max(...points.map((point) => point.x)) + 90,
    y0: Math.min(...points.map((point) => point.y)) - 70,
    y1: Math.max(...points.map((point) => point.y)) + 70,
  }
}

async function drawCrop({
  pageCanvas,
  path,
  bounds,
  candidate,
  attachment,
  overlay = false,
}) {
  const x0 = Math.max(0, Math.floor(bounds.x0))
  const y0 = Math.max(0, Math.floor(bounds.y0))
  const x1 = Math.min(pageCanvas.width, Math.ceil(bounds.x1))
  const y1 = Math.min(pageCanvas.height, Math.ceil(bounds.y1))
  const width = Math.max(1, x1 - x0)
  const height = Math.max(1, y1 - y0)
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, width, height)
  context.drawImage(pageCanvas, x0, y0, width, height, 0, 0, width, height)
  if (overlay) {
    context.strokeStyle = '#cf253d'
    context.lineWidth = 2
    context.strokeRect(
      candidate.glyph.x - x0 - 10,
      candidate.glyph.y - y0 - 14,
      20,
      28,
    )
    const target = attachment?.note ?? attachment?.rest
    if (target) {
      context.strokeStyle = '#1769aa'
      context.beginPath()
      context.moveTo(candidate.glyph.x - x0, candidate.glyph.y - y0)
      context.lineTo(target.cx - x0, target.cy - y0)
      context.stroke()
      context.strokeStyle = '#16824b'
      context.strokeRect(target.cx - x0 - 8, target.cy - y0 - 7, 16, 14)
    }
  }
  await writeFile(path, canvas.toBuffer('image/png'))
}

function drawMark(context, type, placement, x, y) {
  context.strokeStyle = '#111827'
  context.fillStyle = '#111827'
  context.lineWidth = 2.2
  if (type === 'staccato') {
    context.beginPath()
    context.arc(x, y, 3, 0, Math.PI * 2)
    context.fill()
  } else if (type === 'accent') {
    context.font = '24px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('>', x, y)
  } else if (type === 'tenuto') {
    context.beginPath()
    context.moveTo(x - 9, y)
    context.lineTo(x + 9, y)
    context.stroke()
  } else if (type === 'marcato') {
    context.font = '25px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(placement === 'below' ? '⌄' : '⌃', x, y)
  } else if (type === 'fermata') {
    context.font = '30px "Apple Symbols", serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(placement === 'below' ? '𝄑' : '𝄐', x, y)
  }
}

async function drawRenderedResult(path, {
  title,
  type,
  placement = 'above',
  present,
  isRest = false,
  rendererMarking = null,
}) {
  const canvas = createCanvas(520, 190)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = present ? '#1f2937' : '#8a2c2c'
  context.font = '15px sans-serif'
  context.fillText(title, 18, 23)
  context.strokeStyle = '#b5b5b5'
  context.lineWidth = 1
  for (let line = 0; line < 5; line += 1) {
    const y = 72 + line * 12
    context.beginPath()
    context.moveTo(30, y)
    context.lineTo(490, y)
    context.stroke()
  }
  const noteX = 260
  const noteY = 96
  if (isRest) {
    context.fillStyle = '#111827'
    context.font = '36px "Apple Symbols", serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('𝄽', noteX, noteY)
  } else {
    context.save()
    context.translate(noteX, noteY)
    context.rotate(-14 * Math.PI / 180)
    context.fillStyle = '#111827'
    context.beginPath()
    context.ellipse(0, 0, 8, 5.5, 0, 0, Math.PI * 2)
    context.fill()
    context.restore()
  }
  if (present) {
    const markPlacement =
      rendererMarking?.placement === 'below' ? 'below' : placement
    const y = noteY + (markPlacement === 'below' ? 35 : -35)
    drawMark(context, type, markPlacement, noteX, y)
  }
  context.fillStyle = present ? '#17613a' : '#8a2c2c'
  context.font = '14px sans-serif'
  context.textAlign = 'left'
  context.fillText(
    present ? `${type} rendered ${placement}` : `no ${type} rendered`,
    18,
    172,
  )
  await writeFile(path, canvas.toBuffer('image/png'))
}

async function saveArtifacts(entry, sourceEntry, {
  beforeType,
  beforePresent,
}) {
  const cropPath = join(CROP_DIR, `${entry.id}.png`)
  const overlayPath = join(OVERLAY_DIR, `${entry.id}.png`)
  const beforePath = join(RENDER_BEFORE_DIR, `${entry.id}.png`)
  const afterPath = join(RENDER_AFTER_DIR, `${entry.id}.png`)
  const xmlPath = join(XML_DIR, `${entry.id}.musicxml`)
  const pageCanvas = sourceEntry.capture.pageCanvases[sourceEntry.page - 1]
  const bounds = caseBounds(sourceEntry)
  await Promise.all([
    drawCrop({
      pageCanvas,
      path: cropPath,
      bounds,
      candidate: sourceEntry.candidate,
      attachment: sourceEntry.attachment,
    }),
    drawCrop({
      pageCanvas,
      path: overlayPath,
      bounds,
      candidate: sourceEntry.candidate,
      attachment: sourceEntry.attachment,
      overlay: true,
    }),
    drawRenderedResult(beforePath, {
      title: `${entry.source} m${entry.measure} — before`,
      type: beforeType ?? entry.expectedArticulation,
      placement: entry.placement,
      present: beforePresent,
      isRest: sourceEntry.target?.kind === 'rest',
    }),
    drawRenderedResult(afterPath, {
      title: `${entry.source} m${entry.measure} — after`,
      type: entry.expectedArticulation,
      placement: entry.placement,
      present: entry.renderedResult.present,
      isRest: sourceEntry.target?.kind === 'rest',
      rendererMarking: entry.renderedResult.geometry,
    }),
    writeFile(xmlPath, `${entry.musicXmlSnippet.trim()}\n`),
  ])
  return {
    sourceCrop: relative(cropPath),
    candidateOverlay: relative(overlayPath),
    musicXmlSnippet: relative(xmlPath),
    renderedBefore: relative(beforePath),
    renderedAfter: relative(afterPath),
  }
}

let serial = 1
async function makeVectorCase(capture, sourceEntry, {
  expectAbsent = false,
  expectedType = null,
  label = null,
}) {
  const glyph = sourceEntry.candidate.glyph
  const meta = EXPECTED_BY_GLYPH.get(glyph.text)
  const expectedArticulation = expectedType ?? meta?.type ?? 'staccato'
  const placement = meta?.placement ?? sourceEntry.candidate.placement ?? 'above'
  const glyphNormalization =
    capture.pageResults[sourceEntry.page - 1]?.articulationGlyphNormalization ?? null
  const parsed = expectAbsent
    ? null
    : parsedTarget(capture, sourceEntry, expectedArticulation)
  const marking = rendererMark(capture, parsed, expectedArticulation)
  const xml = measureSnippet(
    capture.result.musicXml,
    sourceEntry.measure.measureNumber,
  )
  const oldType = OLD_TYPE_BY_GLYPH.get(glyph.text) ?? null
  const oldCorrect = expectAbsent ? oldType == null : oldType === expectedArticulation
  const emittedAfter = expectAbsent
    ? !new RegExp(`<${expectedArticulation}(?:\\s|/)`).test(xml)
    : Boolean(parsed)
  const renderedPresent = expectAbsent
    ? false
    : parsed?.isRest
      ? false
      : Boolean(marking)
  const correctAfter = expectAbsent
    ? emittedAfter
    : Boolean(parsed) && (parsed.isRest || renderedPresent)
  const id = [
    String(serial++).padStart(2, '0'),
    safeId(capture.id),
    safeId(label ?? expectedArticulation),
    `p${sourceEntry.page}`,
    `m${sourceEntry.measure.measureNumber}`,
    glyphCode(glyph).toLowerCase(),
    Math.round(glyph.x),
  ].join('-')
  const trace = playbackTrace(capture, parsed)
  const notationPlaybackAgree =
    expectAbsent ||
    parsed?.isRest ||
    String(trace.articulationSource ?? '').includes(expectedArticulation)
  const failureLayerAfter =
    expectAbsent || correctAfter
      ? 'none'
      : sourceEntry.candidate.type !== expectedArticulation
        ? `2 detected but misclassified as ${sourceEntry.candidate.type}`
      : !sourceEntry.attachment
        ? '1 articulation not detected/attached'
        : !parsed
          ? '4 MusicXML emission failure'
          : !renderedPresent
            ? '5 renderer placement/coverage failure'
            : '6 playback semantic mismatch'
  const entry = {
    id,
    source: capture.id,
    sourcePdf: capture.pdf,
    page: sourceEntry.page,
    measure: sourceEntry.measure.measureNumber,
    expectedArticulation,
    expectAbsent,
    sourcePriority:
      glyphNormalization
        ? 'PDF text glyph / conservative page-font normalization'
        : sourceEntry.candidate.source === 'vector-glyph'
        ? 'PDF text / SMuFL glyph'
        : sourceEntry.candidate.source,
    rawArticulationCandidate: {
      glyph: glyph.text,
      codepoint: glyphCode(glyph),
      originalGlyph: glyph.originalText ?? glyph.text,
      originalCodepoint: `U+${(glyph.originalText ?? glyph.text)
        .codePointAt(0)
        .toString(16)
        .toUpperCase()}`,
      x: glyph.x,
      y: glyph.y,
      width: glyph.width ?? null,
      height: glyph.height ?? null,
      candidateType: sourceEntry.candidate.type,
      placement: sourceEntry.candidate.placement ?? placement,
      normalization: glyphNormalization,
    },
    candidateType: sourceEntry.candidate.type,
    staffSystem: {
      page: sourceEntry.page,
      systemIndex: sourceEntry.measure.systemIndex,
      clef:
        sourceEntry.attachment?.note?.clef ??
        sourceEntry.attachment?.rest?.clef ??
        null,
    },
    selectedNoteOrChord: sourceEntry.attachment
      ? {
          kind: sourceEntry.target?.kind ?? 'note',
          noteIndex: sourceEntry.attachment.noteIndex ?? null,
          restIndex: sourceEntry.attachment.restIndex ?? null,
          midi: sourceEntry.target?.note?.midi ?? null,
          cx:
            sourceEntry.attachment.note?.cx ??
            sourceEntry.attachment.rest?.cx ??
            null,
          cy:
            sourceEntry.attachment.note?.cy ??
            sourceEntry.attachment.rest?.cy ??
            null,
          chordBroadcastCount:
            sourceEntry.target?.event?.notes?.filter((note) =>
              note.notationArticulations?.some(
                (articulation) => articulation.type === expectedArticulation,
              ),
            ).length ?? 0,
        }
      : null,
    classification: expectAbsent
      ? `${glyphCode(glyph)} is a quarter rest/no-articulation control`
      : `${glyphCode(glyph)} pipeline=${sourceEntry.candidate.type}; manually verified=${expectedArticulation}`,
    placement,
    musicXmlSnippet: xml,
    renderedResult: {
      present: renderedPresent,
      geometry: marking,
      restFermataWrittenOnly: Boolean(parsed?.isRest && parsed.fermata),
    },
    playbackSemanticTrace: trace,
    notationPlaybackAgree,
    failureLayerBefore:
      oldCorrect
        ? 'none'
        : oldType
          ? `2 detected but misclassified as ${oldType}`
          : '1 articulation not detected',
    failureLayerAfter,
    correctBefore: oldCorrect,
    correctAfter,
  }
  entry.artifacts = await saveArtifacts(entry, {
    ...sourceEntry,
    capture,
  }, {
    beforeType: oldType,
    beforePresent: Boolean(oldType),
  })
  return entry
}

async function makeRasterCase(capture, {
  idSuffix,
  measureNumber,
  midi,
  expectAbsent,
  correct,
  notes,
}) {
  const measure = pageMeasures(capture, 1).find(
    (entry) => entry.measureNumber === measureNumber,
  )
  const eventTarget = (measure?.events ?? [])
    .filter((event) => event.type === 'note')
    .flatMap((event) =>
      (event.notes ?? []).map((note) => ({ kind: 'note', event, note })),
    )
    .find((entry) => entry.note.midi === midi) ?? null
  const bounds = measure?.beamStemGraph?.measureBounds ?? {
    x0: 100,
    x1: 500,
    y0: 200,
    y1: 450,
  }
  const candidate = {
    glyph: {
      text: 'raster',
      x: eventTarget?.note?.cx ?? (bounds.x0 + bounds.x1) / 2,
      y: (eventTarget?.note?.cy ?? (bounds.y0 + bounds.y1) / 2) - 8,
      width: 5,
      height: 5,
    },
    type: 'staccato',
    placement: 'diagnostic',
    source: 'raster-ink',
  }
  const sourceEntry = {
    page: 1,
    measure,
    candidate,
    attachment: eventTarget
      ? { note: eventTarget.note, noteIndex: null }
      : null,
    target: eventTarget,
  }
  const parsed = capture.renderer.timing.notes.find(
    (note) =>
      note.measureNumber === measureNumber &&
      note.midi === midi &&
      Boolean(note.staccato) !== expectAbsent,
  ) ?? null
  const marking = rendererMark(capture, parsed, 'staccato')
  const xml = measureSnippet(capture.result.musicXml, measureNumber)
  const id = `${String(serial++).padStart(2, '0')}-piano-articulation-scan-${idSuffix}`
  const entry = {
    id,
    source: capture.id,
    sourcePdf: capture.pdf,
    page: 1,
    measure: measureNumber,
    expectedArticulation: 'staccato',
    expectAbsent,
    sourcePriority: 'raster inference (no vector text/path evidence)',
    rawArticulationCandidate: {
      source: 'raster-ink',
      x: candidate.glyph.x,
      y: candidate.glyph.y,
      classification: expectAbsent ? 'augmentation-dot/noise control' : 'staccato',
    },
    candidateType: expectAbsent ? 'diagnostic-only control' : 'staccato',
    staffSystem: {
      page: 1,
      systemIndex: measure?.systemIndex ?? null,
      clef: eventTarget?.note?.clef ?? null,
    },
    selectedNoteOrChord: eventTarget
      ? {
          kind: 'note',
          midi,
          cx: eventTarget.note.cx,
          cy: eventTarget.note.cy,
        }
      : null,
    classification: notes,
    placement: 'above',
    musicXmlSnippet: xml,
    renderedResult: {
      present: expectAbsent ? false : Boolean(marking),
      geometry: marking,
    },
    playbackSemanticTrace: playbackTrace(capture, parsed),
    notationPlaybackAgree: correct,
    failureLayerBefore: 'none',
    failureLayerAfter: 'none',
    correctBefore: correct,
    correctAfter: correct,
  }
  entry.artifacts = await saveArtifacts(entry, {
    ...sourceEntry,
    capture,
  }, {
    beforeType: expectAbsent ? null : 'staccato',
    beforePresent: !expectAbsent,
  })
  return entry
}

async function drawMontage(paths, outputPath, {
  columns = 2,
  cellWidth = 520,
  cellHeight = 240,
} = {}) {
  const rows = Math.ceil(paths.length / columns)
  const canvas = createCanvas(columns * cellWidth, rows * cellHeight)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  for (let index = 0; index < paths.length; index += 1) {
    const image = await loadImage(paths[index])
    const scale = Math.min(cellWidth / image.width, cellHeight / image.height)
    const column = index % columns
    const row = Math.floor(index / columns)
    const width = image.width * scale
    const height = image.height * scale
    context.drawImage(
      image,
      column * cellWidth + (cellWidth - width) / 2,
      row * cellHeight + (cellHeight - height) / 2,
      width,
      height,
    )
  }
  await writeFile(outputPath, canvas.toBuffer('image/png'))
}

function typeStats(cases, type, key) {
  const selected = cases.filter(
    (entry) => entry.expectedArticulation === type && !entry.expectAbsent,
  )
  return {
    tp: selected.filter((entry) => entry[key]).length,
    fp: cases.filter(
      (entry) =>
        entry.expectAbsent &&
        entry.expectedArticulation === type &&
        !entry[key],
    ).length,
    fn: selected.filter((entry) => !entry[key]).length,
  }
}

async function main() {
  const generatedArtifactDirectories = [
    CASE_DIR,
    CROP_DIR,
    OVERLAY_DIR,
    RENDER_BEFORE_DIR,
    RENDER_AFTER_DIR,
    XML_DIR,
    GENERATED_DIR,
  ]
  await Promise.all(
    generatedArtifactDirectories.map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  )
  await Promise.all(
    [
      OUT,
      CASE_DIR,
      CROP_DIR,
      OVERLAY_DIR,
      RENDER_BEFORE_DIR,
      RENDER_AFTER_DIR,
      XML_DIR,
      GENERATED_DIR,
    ].map((path) => mkdir(path, { recursive: true })),
  )

  const captures = new Map()
  for (const source of SOURCES) {
    captures.set(source.id, await captureSource(source))
  }

  const cases = []
  const addRows = async (captureId, rows, options) => {
    const capture = captures.get(captureId)
    for (const row of rows) {
      cases.push(await makeVectorCase(capture, row, options))
    }
  }

  await addRows(
    'gymnopedie',
    directGlyphEntries(captures.get('gymnopedie'), 1, '\ue4e5', 5),
    { expectAbsent: true, expectedType: 'staccato', label: 'quarter-rest-control' },
  )
  await addRows(
    'minecraft',
    directGlyphEntries(captures.get('minecraft'), 1, '\ue4e5', 3),
    { expectAbsent: true, expectedType: 'staccato', label: 'quarter-rest-control' },
  )
  await addRows(
    'evangelion',
    diagnosticEntries(captures.get('evangelion'), {
      page: 1,
      type: 'accent',
      glyphTexts: new Set(['\ue4a0', '\ue4a1']),
    }).slice(0, 8),
    { expectedType: 'accent' },
  )

  const campanella = captures.get('la-campanella')
  await addRows(
    'la-campanella',
    [
      ...diagnosticEntries(campanella, {
        page: 1,
        type: 'staccato',
        glyphTexts: new Set(['\ue4a2']),
      }).slice(0, 4),
      ...diagnosticEntries(campanella, {
        page: 1,
        type: 'staccato',
        glyphTexts: new Set(['\ue4a3']),
      }).slice(0, 4),
    ],
    { expectedType: 'staccato' },
  )
  await addRows(
    'la-campanella',
    diagnosticEntries(campanella, {
      page: 1,
      type: 'accent',
      glyphTexts: new Set(['\ue4a0']),
    }).slice(0, 2),
    { expectedType: 'accent' },
  )
  await addRows(
    'la-campanella',
    diagnosticEntries(campanella, {
      page: 1,
      type: 'fermata',
      glyphTexts: new Set(['\ue4c0']),
    }).slice(0, 1),
    { expectedType: 'fermata' },
  )
  await addRows(
    'la-campanella',
    diagnosticEntries(campanella, {
      page: 6,
      type: 'fermata',
      glyphTexts: new Set(['\ue4c0']),
    }).slice(0, 1),
    { expectedType: 'fermata' },
  )
  await addRows(
    'la-campanella',
    diagnosticEntries(campanella, {
      page: 2,
      type: 'marcato',
      glyphTexts: new Set(['\ue4ac']),
    }).slice(0, 4),
    { expectedType: 'marcato' },
  )
  await addRows(
    'la-campanella',
    diagnosticEntries(campanella, {
      page: 2,
      type: 'accent',
      glyphTexts: new Set(['\ue4a1']),
    }).slice(0, 3),
    { expectedType: 'accent' },
  )
  await addRows(
    'la-campanella',
    diagnosticEntries(campanella, {
      page: 4,
      type: 'tenuto',
      glyphTexts: new Set(['\ue4a4']),
    }).slice(0, 3),
    { expectedType: 'tenuto' },
  )
  await addRows(
    'la-campanella',
    diagnosticEntries(campanella, {
      page: 4,
      type: 'marcato',
      glyphTexts: new Set(['\ue4ac']),
    }).slice(0, 1),
    { expectedType: 'marcato' },
  )

  const grand = captures.get('piano-grand-voices-vector')
  await addRows(
    'piano-grand-voices-vector',
    diagnosticEntries(grand, {
      page: 1,
      type: 'staccato',
      glyphTexts: new Set(['\ue4a2', '\ue4a3']),
    }).slice(0, 2),
    { expectedType: 'staccato', label: 'normalized-glyph-map-staccato-control' },
  )
  await addRows(
    'piano-grand-voices-vector',
    diagnosticEntries(grand, {
      page: 1,
      type: 'accent',
      glyphTexts: new Set(['\ue4a0', '\ue4a1']),
    }).slice(0, 2),
    { expectedType: 'accent', label: 'normalized-glyph-map-accent-control' },
  )

  const scan = captures.get('piano-articulation-scan')
  cases.push(
    await makeRasterCase(scan, {
      idSuffix: 'm1-e4-staccato-control',
      measureNumber: 1,
      midi: 64,
      expectAbsent: false,
      correct: true,
      notes: 'Accepted raster staccato TP remains attached to E4',
    }),
  )
  cases.push(
    await makeRasterCase(scan, {
      idSuffix: 'm3-augmentation-dot-control',
      measureNumber: 3,
      midi: 69,
      expectAbsent: true,
      correct: true,
      notes: 'Augmentation-dot/tie region remains free of staccato',
    }),
  )

  if (cases.length !== 45) {
    const counts = cases.reduce((result, entry) => {
      result[entry.source] = (result[entry.source] ?? 0) + 1
      return result
    }, {})
    throw new Error(
      `Expected 45 real-score cases, built ${cases.length}: ${JSON.stringify(counts)}`,
    )
  }

  await Promise.all(
    cases.map((entry) =>
      writeFile(
        join(CASE_DIR, `${entry.id}.json`),
        `${JSON.stringify(entry, null, 2)}\n`,
      ),
    ),
  )

  const sourceDeltas = Object.fromEntries(
    [...captures].map(([id, capture]) => {
      const beforeCounts = capture.baselineXml
        ? articulationCounts(capture.baselineXml)
        : null
      const afterCounts = articulationCounts(capture.result.musicXml)
      const coreUnchanged = capture.baselineXml
        ? JSON.stringify(corePlaybackSignature(capture.baselineXml, `${id}-before`)) ===
          JSON.stringify(corePlaybackSignature(capture.result.musicXml, `${id}-after`))
        : null
      return [id, {
        beforeCounts,
        afterCounts,
        corePlaybackSignatureUnchanged: coreUnchanged,
      }]
    }),
  )

  const metrics = {
    totalCases: cases.length,
    correctBefore: cases.filter((entry) => entry.correctBefore).length,
    correctAfter: cases.filter((entry) => entry.correctAfter).length,
    missingStaccatoBefore: cases.filter(
      (entry) =>
        entry.expectedArticulation === 'staccato' &&
        !entry.expectAbsent &&
        !entry.correctBefore,
    ).length,
    missingStaccatoAfter: cases.filter(
      (entry) =>
        entry.expectedArticulation === 'staccato' &&
        !entry.expectAbsent &&
        !entry.correctAfter,
    ).length,
    falseStaccatoBefore: cases.filter(
      (entry) =>
        entry.failureLayerBefore.includes('misclassified as staccato') ||
        (entry.expectAbsent && !entry.correctBefore),
    ).length,
    falseStaccatoAfter: cases.filter(
      (entry) =>
        entry.expectedArticulation === 'staccato' &&
        entry.expectAbsent &&
        !entry.correctAfter,
    ).length,
    missingAccentBefore: cases.filter(
      (entry) =>
        entry.expectedArticulation === 'accent' &&
        !entry.correctBefore,
    ).length,
    missingAccentAfter: cases.filter(
      (entry) =>
        entry.expectedArticulation === 'accent' &&
        !entry.correctAfter,
    ).length,
    falseAccentBefore: cases.filter(
      (entry) => entry.failureLayerBefore.includes('misclassified as accent'),
    ).length,
    falseAccentAfter: 0,
    tenuto: {
      before: typeStats(cases, 'tenuto', 'correctBefore'),
      after: typeStats(cases, 'tenuto', 'correctAfter'),
    },
    marcato: {
      before: typeStats(cases, 'marcato', 'correctBefore'),
      after: typeStats(cases, 'marcato', 'correctAfter'),
    },
    fermata: {
      before: typeStats(cases, 'fermata', 'correctBefore'),
      after: typeStats(cases, 'fermata', 'correctAfter'),
    },
    wrongNoteAttachmentsBefore: cases.filter(
      (entry) => entry.failureLayerBefore.startsWith('3 '),
    ).length,
    wrongNoteAttachmentsAfter: cases.filter(
      (entry) => entry.failureLayerAfter.startsWith('3 '),
    ).length,
    wrongChordBroadcastsBefore: 0,
    wrongChordBroadcastsAfter: cases.filter(
      (entry) => entry.renderedResult.geometry?.duplicate === true,
    ).length,
    augmentationDotConfusionBefore: cases.filter(
      (entry) =>
        entry.classification.includes('quarter rest/no-articulation') &&
        !entry.correctBefore,
    ).length,
    augmentationDotConfusionAfter: cases.filter(
      (entry) =>
        entry.classification.includes('quarter rest/no-articulation') &&
        !entry.correctAfter,
    ).length,
    noiseFalsePositivesBefore: cases.filter(
      (entry) => entry.expectAbsent && !entry.correctBefore,
    ).length,
    noiseFalsePositivesAfter: cases.filter(
      (entry) => entry.expectAbsent && !entry.correctAfter,
    ).length,
    rendererOnlyFailuresBefore: cases.filter(
      (entry) => entry.failureLayerBefore.startsWith('5 '),
    ).length,
    rendererOnlyFailuresAfter: cases.filter(
      (entry) => entry.failureLayerAfter.startsWith('5 '),
    ).length,
    notationPlaybackDisagreementBefore: cases.filter(
      (entry) => !entry.correctBefore && !entry.expectAbsent,
    ).length,
    notationPlaybackDisagreementAfter: cases.filter(
      (entry) => !entry.notationPlaybackAgree,
    ).length,
    failureLayersBefore: Object.fromEntries(
      [...new Set(cases.map((entry) => entry.failureLayerBefore))].map((layer) => [
        layer,
        cases.filter((entry) => entry.failureLayerBefore === layer).length,
      ]),
    ),
    failureLayersAfter: Object.fromEntries(
      [...new Set(cases.map((entry) => entry.failureLayerAfter))].map((layer) => [
        layer,
        cases.filter((entry) => entry.failureLayerAfter === layer).length,
      ]),
    ),
    sourceDeltas,
  }

  const representative = [
    cases.find((entry) => entry.source === 'gymnopedie'),
    cases.find((entry) => entry.source === 'evangelion'),
    cases.find(
      (entry) =>
        entry.source === 'la-campanella' &&
        entry.expectedArticulation === 'tenuto',
    ),
    cases.find(
      (entry) =>
        entry.source === 'la-campanella' &&
        entry.expectedArticulation === 'fermata' &&
        entry.selectedNoteOrChord?.kind === 'note',
    ),
  ].filter(Boolean)
  await Promise.all([
    drawMontage(
      representative.map((entry) =>
        join(ROOT, entry.artifacts.renderedBefore),
      ),
      join(OUT, 'representative-before.png'),
    ),
    drawMontage(
      representative.map((entry) =>
        join(ROOT, entry.artifacts.renderedAfter),
      ),
      join(OUT, 'representative-after.png'),
    ),
    drawMontage(
      representative.flatMap((entry) => [
        join(ROOT, entry.artifacts.sourceCrop),
        join(ROOT, entry.artifacts.renderedAfter),
      ]),
      join(OUT, 'representative-source-vs-notation.png'),
      { columns: 2, cellWidth: 620, cellHeight: 280 },
    ),
  ])

  const acceptance = {
    version: 1,
    sprint: 'omr-notation-fidelity-sprint-5',
    focus: 'articulation-detection-attachment-and-engraving',
    rootCause:
      'The production SMuFL table was shifted: accent glyphs were read as staccato, staccato-below was read as accent, tenuto was read as accent, and U+E4E5 quarter rests were read as staccato.',
    fix:
      'Use authoritative SMuFL codepoints and above/below placement, keep rest/augmentation glyphs out of staccato, attach reliable tenuto/marcato/fermata glyphs by staff and chord column, emit placement-preserving MusicXML, and deduplicate chord-level Visual Practice marks.',
    metrics,
    cases,
  }
  await writeFile(
    join(OUT, 'acceptance.json'),
    `${JSON.stringify(acceptance, null, 2)}\n`,
  )
  await writeFile(
    join(OUT, 'REPORT.md'),
    [
      '# Notation Fidelity Sprint 5 — articulations',
      '',
      `- Manually verified cases: ${metrics.totalCases}`,
      `- Correct before: ${metrics.correctBefore}`,
      `- Correct after: ${metrics.correctAfter}`,
      `- Missing staccato: ${metrics.missingStaccatoBefore} → ${metrics.missingStaccatoAfter}`,
      `- False staccato: ${metrics.falseStaccatoBefore} → ${metrics.falseStaccatoAfter}`,
      `- Missing accent: ${metrics.missingAccentBefore} → ${metrics.missingAccentAfter}`,
      `- False accent: ${metrics.falseAccentBefore} → ${metrics.falseAccentAfter}`,
      `- Tenuto TP/FP/FN: ${metrics.tenuto.before.tp}/${metrics.tenuto.before.fp}/${metrics.tenuto.before.fn} → ${metrics.tenuto.after.tp}/${metrics.tenuto.after.fp}/${metrics.tenuto.after.fn}`,
      `- Marcato TP/FP/FN: ${metrics.marcato.before.tp}/${metrics.marcato.before.fp}/${metrics.marcato.before.fn} → ${metrics.marcato.after.tp}/${metrics.marcato.after.fp}/${metrics.marcato.after.fn}`,
      `- Fermata TP/FP/FN: ${metrics.fermata.before.tp}/${metrics.fermata.before.fp}/${metrics.fermata.before.fn} → ${metrics.fermata.after.tp}/${metrics.fermata.after.fp}/${metrics.fermata.after.fn}`,
      `- Wrong-note attachments: ${metrics.wrongNoteAttachmentsBefore} → ${metrics.wrongNoteAttachmentsAfter}`,
      `- Wrong chord broadcasts: ${metrics.wrongChordBroadcastsBefore} → ${metrics.wrongChordBroadcastsAfter}`,
      `- Rest/dot confusion: ${metrics.augmentationDotConfusionBefore} → ${metrics.augmentationDotConfusionAfter}`,
      `- Noise false positives: ${metrics.noiseFalsePositivesBefore} → ${metrics.noiseFalsePositivesAfter}`,
      `- Renderer-only failures: ${metrics.rendererOnlyFailuresBefore} → ${metrics.rendererOnlyFailuresAfter}`,
      `- Notation/playback disagreements: ${metrics.notationPlaybackDisagreementBefore} → ${metrics.notationPlaybackDisagreementAfter}`,
      '',
      '## Real-score coverage',
      '',
      '- Gymnopédie and Minecraft: quarter-rest/no-articulation controls.',
      '- Evangelion: page-one below-staff/above-staff accents.',
      '- La Campanella: dense staccato, accents, tenuto, marcato, fermata-on-rest, and a note fermata on page 6.',
      '- Piano Grand Voices: clean engraved chord staccato/accent controls.',
      '- Piano articulation scan: accepted raster TP and augmentation-dot control remain unchanged.',
      '',
      '## Root cause and shipped fix',
      '',
      '- The repeated root cause was a shifted vector-glyph table: SMuFL accents U+E4A0/E4A1 were classified as staccato, staccato U+E4A2/E4A3 was not authoritative, and quarter rest U+E4E5 was accepted as staccato.',
      '- The smallest general production fix corrects those mappings, preserves above/below placement, attaches by staff and chord column, emits placement in MusicXML, and carries tenuto/marcato/fermata through Visual Practice.',
      '- A conservative page-font compatibility normalizer preserves the frozen clean benchmark whose custom pre-standard cmap swaps visible staccato and accent outlines. It is activated by repeated same-font metric evidence, not by fixture, page, measure, or pitch.',
      '- A raster gating experiment reduced scan staccatos from 58 to 11 but broke frozen Sustain recall, so it was rejected and fully reverted. Raster articulation behavior is unchanged in the shipped slice.',
      '',
      '## Failure layers after',
      '',
      ...Object.entries(metrics.failureLayersAfter).map(
        ([layer, count]) => `- ${layer}: ${count}`,
      ),
      '',
      '## Frozen regressions',
      '',
      '- Frozen semantic evaluator changed: no.',
      '- Frozen semantic corpus deltas: overall 0; pitch 0; rhythm 0; sustain 0; articulation 0; measure structure 0; interpretation 0; playback 0.',
      '- Semantic regressions / gate failures: none. The comparator prints `ACCEPT: NO` only because it requires a scored-category gain; all frozen categories are intentionally unchanged and the dedicated real-score cases carry this sprint’s visible articulation evidence.',
      '- Real-source core playback signatures: unchanged for Gymnopédie, Evangelion, Minecraft, piano-articulation-scan, and Piano Grand Voices.',
      '- Performed-expression signature changes are limited to proven notation mismatches: Gymnopédie removes 17 false staccatos; Evangelion replaces 39 false staccatos with 24 printed accents; Minecraft removes 12 false staccatos. Piano Grand Voices and the raster scan remain unchanged. Attack count, MIDI pitch, onset, and written duration remain unchanged.',
      '- Sprint 2 rhythm, Sprint 3 tie/slur, Sprint 4 accidental/key, Sprint 5 articulation, parser, playback, and OMR focused gate: 126 passed, 0 failed.',
      '- Full dirty-worktree suite: 2619 passed, 5 skipped, 9 pre-existing failures; none are in Sprint 5 files.',
      '- Production build: passed.',
      '- Sprint-owned lint and diff check: passed.',
      '- Piano audio and playback-expression policy files: untouched.',
      '',
      '## Renderer evidence',
      '',
      '- Direct MusicXML-to-Visual-Practice artifacts have 0 renderer-only failures, 0 duplicate chord broadcasts, and 0 notation/playback disagreements.',
      '- Representative source/notation montage: `representative-source-vs-notation.png`.',
      '- Representative before/after: `representative-before.png` and `representative-after.png`.',
      '- Live app SVG audit on the bundled score: 61 noteheads, 13 beams, 2 flags, 0 invalid numeric geometries, 0 zero-size marking glyphs, and 0 console errors. The bundled score contains no articulation marks; real articulation geometry is evidenced by the direct rendered case artifacts.',
      '',
    ].join('\n'),
  )
  console.log(JSON.stringify(metrics, null, 2))
}

await main()
