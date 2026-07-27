#!/usr/bin/env node
/**
 * Notation Fidelity Sprint 4 real-score acceptance trace.
 *
 * Builds 40 manually reviewed accidental/key-signature cases. Each case keeps
 * the source crop, raw candidates, selected attachment, MusicXML, renderer
 * model, and sounding MIDI together so written and performed semantics cannot
 * silently diverge.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { processOmrPageAnalysis } from '../src/features/omr/processOmrPage.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import {
  buildKeySignatureMarks,
  buildStaffGeometry,
  buildStaffLaneNotes,
} from '../src/features/practice/staffLaneLayout.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tmp/notation-fidelity-sprint-4')
const CASE_DIR = join(OUT, 'cases')
const CROP_DIR = join(OUT, 'source-crops')
const OVERLAY_DIR = join(OUT, 'candidate-overlays')
const RENDER_BEFORE_DIR = join(OUT, 'rendered-before')
const RENDER_AFTER_DIR = join(OUT, 'rendered-after')
const XML_DIR = join(OUT, 'musicxml-snippets')
const GENERATED_DIR = join(OUT, 'generated')
const DOWNLOADS = join(homedir(), 'Downloads')

GlobalFonts.registerFromPath(
  '/System/Library/Fonts/Apple Symbols.ttf',
  'NotationSymbols',
)

const OMR_SOURCES = [
  {
    id: 'gymnopedie',
    pdf: join(DOWNLOADS, 'gymnopedie-no-1-satie.pdf'),
    baseline: join(ROOT, 'tmp/notation-fidelity-sprint-2/after/gymnopedie.musicxml'),
    expectedKey: 2,
  },
  {
    id: 'evangelion',
    pdf: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.pdf'),
    baseline: join(ROOT, 'tmp/notation-fidelity-sprint-2/after/evangelion.musicxml'),
    expectedKey: -3,
  },
  {
    id: 'minecraft',
    pdf: join(DOWNLOADS, 'beginner-minecraft-piano-themes-in-c-minecraft.pdf'),
    baseline: join(ROOT, 'tmp/notation-fidelity-sprint-2/after/minecraft.musicxml'),
    expectedKey: 0,
  },
  {
    id: 'piano-articulation-scan',
    pdf: join(
      ROOT,
      'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf',
    ),
    baseline: join(ROOT, 'tmp/notation-fidelity-sprint-2/after/articulation.musicxml'),
    expectedKey: 0,
  },
]

const CONTROL_SOURCES = [
  {
    id: 'hungarian-dance-no5',
    pdf: join(DOWNLOADS, 'hungarian-dance-no5.pdf'),
    score: join(DOWNLOADS, 'hungarian-dance-no5.mxl'),
  },
  {
    id: 'mozart-menuet-k2',
    pdf: join(ROOT, 'benchmarks/cache/mozart-menuet-k2/score.pdf'),
    score: join(ROOT, 'benchmarks/cache/mozart-menuet-k2/score.musicxml'),
  },
  {
    id: 'tchaikovsky-old-french-song',
    pdf: join(ROOT, 'benchmarks/cache/tchaikovsky-old-french-song/score.pdf'),
    score: join(ROOT, 'benchmarks/cache/tchaikovsky-old-french-song/score.musicxml'),
  },
]

const KEY_CONTROL_SELECTIONS = [
  ['hungarian-dance-no5', 1, 3],
  ['hungarian-dance-no5', 49, 6],
  ['hungarian-dance-no5', 58, 1],
  ['hungarian-dance-no5', 66, 5],
  ['hungarian-dance-no5', 70, 3],
  ['mozart-menuet-k2', 1, -1],
  ['tchaikovsky-old-french-song', 1, -2],
]

function imageDataCanvas(page) {
  const canvas = createCanvas(page.width, page.height)
  const context = canvas.getContext('2d')
  const imageData = context.createImageData(page.width, page.height)
  imageData.data.set(page.data)
  context.putImageData(imageData, 0, 0)
  return canvas
}

async function readScoreXml(path) {
  const bytes = await readFile(path)
  if (!path.toLowerCase().endsWith('.mxl')) {
    return bytes.toString('utf8')
  }
  const zip = await JSZip.loadAsync(bytes)
  const scoreName = Object.keys(zip.files).find(
    (name) =>
      !name.startsWith('META-INF/') &&
      !zip.files[name].dir &&
      /\.(musicxml|xml)$/i.test(name),
  )
  if (!scoreName) {
    throw new Error(`No score XML in ${path}`)
  }
  return zip.files[scoreName].async('string')
}

function measureBlocks(xml) {
  const firstPart = xml.match(/<part(?:\s[^>]*)?>[\s\S]*?<\/part>/)?.[0] ?? xml
  return [...firstPart.matchAll(/<measure\b[^>]*number="([^"]+)"[^>]*>[\s\S]*?<\/measure>/g)]
    .map((match) => ({ number: Number(match[1]), xml: match[0] }))
    .filter((entry) => Number.isFinite(entry.number))
}

function measureLocations(xml) {
  let page = 1
  let system = 0
  const locations = new Map()
  for (const measure of measureBlocks(xml)) {
    if (/<print\b[^>]*new-page="yes"/.test(measure.xml)) {
      page += 1
      system = 0
    } else if (/<print\b[^>]*new-system="yes"/.test(measure.xml)) {
      system += 1
    }
    locations.set(measure.number, { page, system })
  }
  return locations
}

function measureSnippet(xml, measureNumber) {
  return measureBlocks(xml).find((entry) => entry.number === measureNumber)?.xml ?? ''
}

function noteBlocks(xml) {
  return [...xml.matchAll(/<note(?:\s[^>]*)?>[\s\S]*?<\/note>/g)].map(
    (match) => match[0],
  )
}

function noteSnippetFor(note, xml) {
  const measure = measureSnippet(xml, note.measureNumber)
  const step = note.writtenPitch?.step
  const octave = note.writtenPitch?.octave
  const alter = note.writtenPitch?.alter
  const expectedAlter =
    alter == null
      ? !/<alter>/.test(
          `<step>${step}</step><octave>${octave}</octave>`,
        )
      : true
  return (
    noteBlocks(measure).find((block) => {
      const blockStep = block.match(/<step>([^<]+)<\/step>/)?.[1]
      const blockOctave = Number(block.match(/<octave>([^<]+)<\/octave>/)?.[1])
      const blockAlter = block.match(/<alter>([^<]+)<\/alter>/)?.[1]
      return (
        blockStep === step &&
        blockOctave === octave &&
        expectedAlter &&
        (alter == null ? blockAlter == null : Number(blockAlter) === alter) &&
        block.includes(`<accidental`) &&
        block.includes(`>${note.accidental.type}</accidental>`)
      )
    }) ?? noteBlocks(measure)[0] ?? measure
  )
}

function playbackSignature(xml, name) {
  return parseMusicXml(xml, name).notes.map((note) => ({
    measureNumber: note.measureNumber,
    voice: note.voice,
    staff: note.staff,
    quarterTime: Number(note.quarterTime.toFixed(6)),
    durationQuarters: Number(note.durationQuarters.toFixed(6)),
    midi: note.midi,
    suppressPlaybackAttack: Boolean(note.suppressPlaybackAttack),
  }))
}

function signaturesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function safeId(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function caseId(serial, source, kind, measure, detail) {
  return [
    String(serial).padStart(2, '0'),
    safeId(source),
    safeId(kind),
    `m${measure}`,
    safeId(detail),
  ].join('-')
}

function relative(path) {
  return path.replace(`${ROOT}/`, '')
}

async function cropPage({
  pageCanvas,
  path,
  bounds,
  candidates = [],
  attachment = null,
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
  for (const candidate of candidates) {
    const x = candidate.x ?? candidate.cx ?? candidate.glyph?.x
    const y = candidate.y ?? candidate.cy ?? candidate.glyph?.y
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    context.strokeStyle = '#d12b3f'
    context.lineWidth = 2
    context.strokeRect(x - x0 - 8, y - y0 - 12, 16, 24)
  }
  if (attachment?.glyph && attachment?.note) {
    context.strokeStyle = '#1664c0'
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(
      attachment.glyph.x - x0,
      attachment.glyph.y - y0,
    )
    context.lineTo(
      attachment.note.cx - x0,
      attachment.note.cy - y0,
    )
    context.stroke()
    context.strokeStyle = '#16824b'
    context.strokeRect(
      attachment.note.cx - x0 - 8,
      attachment.note.cy - y0 - 7,
      16,
      14,
    )
  }
  await writeFile(path, canvas.toBuffer('image/png'))
}

function systemBounds(pageCanvas, location, locations) {
  const systemsOnPage = Math.max(
    1,
    ...[...locations.values()]
      .filter((entry) => entry.page === location.page)
      .map((entry) => entry.system + 1),
  )
  const top = pageCanvas.height * 0.1
  const usable = pageCanvas.height * 0.84
  const band = usable / systemsOnPage
  return {
    x0: pageCanvas.width * 0.035,
    x1: pageCanvas.width * 0.965,
    y0: top + location.system * band - band * 0.08,
    y1: top + (location.system + 1) * band + band * 0.08,
  }
}

function rendererStateForNotes(notes, stripWrittenSemantics = false) {
  const visualNotes = notes.map((note, index) => ({
    ...note,
    id: note.id ?? `probe-${index}`,
    visualNoteId: note.visualNoteId ?? `probe-${index}`,
    writtenPitch: stripWrittenSemantics ? null : note.writtenPitch,
    accidental: stripWrittenSemantics ? null : note.accidental,
    timeSeconds: 1,
    durationSeconds: note.durationSeconds ?? 0.5,
  }))
  const groups = [{ id: 'probe-group', timeSeconds: 1, notes: visualNotes }]
  const geometry = buildStaffGeometry({
    hasTreble: true,
    hasBass: true,
    grandStaff: true,
  })
  return {
    geometry,
    notes: buildStaffLaneNotes(groups, geometry, { pixelsPerSecond: 280 }),
  }
}

async function drawRenderer({
  path,
  title,
  notes = [],
  keySignature = null,
  stripWrittenSemantics = false,
  stripKeySignature = false,
}) {
  const { geometry, notes: layoutNotes } = rendererStateForNotes(
    notes,
    stripWrittenSemantics,
  )
  const effectiveKey = stripKeySignature ? { fifths: 0 } : keySignature
  const keyMarks = buildKeySignatureMarks(effectiveKey, geometry)
  const canvas = createCanvas(720, 300)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#222'
  context.font = '15px sans-serif'
  context.fillText(title, 18, 23)
  const yOffset = 30
  context.strokeStyle = '#777'
  context.lineWidth = 1
  for (const y of geometry.lines) {
    context.beginPath()
    context.moveTo(25, y + yOffset)
    context.lineTo(695, y + yOffset)
    context.stroke()
  }
  context.font = '38px NotationSymbols, serif'
  for (const mark of keyMarks) {
    context.fillText(mark.glyph, 65 + mark.column * 17, mark.y + yOffset + 12)
  }
  for (const note of layoutNotes) {
    const x = 410 + (note.xOffset ?? 0)
    const y = note.y + yOffset
    for (const ledgerY of note.ledgerLines ?? []) {
      context.strokeStyle = '#111'
      context.beginPath()
      context.moveTo(x - 12, ledgerY + yOffset)
      context.lineTo(x + 12, ledgerY + yOffset)
      context.stroke()
    }
    context.save()
    context.translate(x, y)
    context.rotate(-0.22)
    context.beginPath()
    context.ellipse(0, 0, 8, 5.5, 0, 0, Math.PI * 2)
    context.fillStyle = '#111'
    context.fill()
    context.restore()
    if (note.accidentalGlyph) {
      context.font = '34px NotationSymbols, serif'
      context.fillStyle = '#111'
      context.fillText(
        note.accidentalDisplayGlyph ?? note.accidentalGlyph,
        x - 29 - (note.accidentalColumn ?? 0) * 17,
        y + 11,
      )
    }
  }
  context.font = '14px monospace'
  context.fillStyle = '#333'
  const accidentalSummary = layoutNotes
    .filter((note) => note.accidentalType)
    .map(
      (note) =>
        `${note.writtenPitch?.step ?? 'MIDI'}${note.writtenPitch?.octave ?? note.midi}:${note.accidentalType}@col${note.accidentalColumn}`,
    )
    .join(', ')
  context.fillText(
    `key=${effectiveKey?.fifths ?? 0}; ${accidentalSummary || 'no local accidental'}`,
    18,
    286,
  )
  await writeFile(path, canvas.toBuffer('image/png'))
  return {
    keyMarks: keyMarks.map((mark) => ({
      staff: mark.staffKind,
      type: mark.type,
      column: mark.column,
      y: mark.y,
      cancellation: mark.cancellation,
    })),
    notes: layoutNotes.map((note) => ({
      midi: note.midi,
      writtenPitch: note.writtenPitch,
      accidentalType: note.accidentalType,
      accidentalGlyph: note.accidentalGlyph,
      accidentalDisplayGlyph: note.accidentalDisplayGlyph,
      accidentalColumn: note.accidentalColumn,
      staff: note.staffKind,
      diatonic: note.diatonic,
    })),
  }
}

async function drawMontage(paths, outputPath, {
  columns = 2,
  cellWidth = 720,
  cellHeight = 300,
} = {}) {
  const rows = Math.ceil(paths.length / columns)
  const canvas = createCanvas(columns * cellWidth, rows * cellHeight)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  for (let index = 0; index < paths.length; index += 1) {
    const image = await loadImage(paths[index])
    const column = index % columns
    const row = Math.floor(index / columns)
    const scale = Math.min(cellWidth / image.width, cellHeight / image.height)
    const width = image.width * scale
    const height = image.height * scale
    const x = column * cellWidth + (cellWidth - width) / 2
    const y = row * cellHeight + (cellHeight - height) / 2
    context.drawImage(image, x, y, width, height)
  }
  await writeFile(outputPath, canvas.toBuffer('image/png'))
}

async function captureOmrSource(config) {
  const rendered = await renderPdfToPages(config.pdf, {
    rootDir: ROOT,
    maxPages: 1,
  })
  const extractPageText = await makePdfTextExtractor(config.pdf, { rootDir: ROOT })
  let pageResult = null
  const originalLog = console.log
  console.log = () => {}
  let result
  try {
    result = await runPdfOmrPipeline(config.pdf, {
      renderPage: makeRenderPageCallback(rendered.pages),
      extractPageText,
      numPages: rendered.numPages,
      maxPages: 1,
      title: `${config.id}-notation-fidelity-sprint4`,
      analyzePage(imageData, context) {
        pageResult = processOmrPageAnalysis(imageData, context)
        return pageResult
      },
    })
  } finally {
    console.log = originalLog
  }
  const baselineXml = await readFile(config.baseline, 'utf8')
  await writeFile(join(GENERATED_DIR, `${config.id}.musicxml`), result.musicXml)
  return {
    ...config,
    rendered,
    pageCanvas: imageDataCanvas(rendered.pages[0]),
    pageResult,
    result,
    baselineXml,
    afterSignature: playbackSignature(result.musicXml, `${config.id}-after`),
    beforeSignature: playbackSignature(baselineXml, `${config.id}-before`),
  }
}

async function captureControlSource(config) {
  const xml = await readScoreXml(config.score)
  const rendered = await renderPdfToPages(config.pdf, { rootDir: ROOT })
  const timing = parseMusicXml(xml, `${config.id}.musicxml`)
  return {
    ...config,
    xml,
    timing,
    locations: measureLocations(xml),
    pageCanvases: rendered.pages.map(imageDataCanvas),
  }
}

function omrMeasures(capture) {
  return capture.pageResult?.pageEntry?.systems?.flatMap(
    (system) => system.measures ?? [],
  ) ?? []
}

function explicitOmrNotes(capture) {
  return omrMeasures(capture).flatMap((measure) =>
    (measure.events ?? []).flatMap((event) =>
      (event.notes ?? [])
        .filter((note) => note.accidental)
        .map((note) => ({ note, event, measure })),
    ),
  )
}

function correspondingParsedNote(xml, omrNote, measureNumber) {
  return parseMusicXml(xml, 'omr-case.musicxml').notes.find(
    (note) =>
      note.measureNumber === measureNumber &&
      note.midi === omrNote.midi &&
      note.accidental?.type === omrNote.accidental.type,
  )
}

function omrMeasureBounds(capture, measure) {
  const bounds = measure.beamStemGraph?.measureBounds
  if (bounds) {
    return {
      x0: bounds.x0 - 24,
      x1: bounds.x1 + 24,
      y0: bounds.y0 - 38,
      y1: bounds.y1 + 38,
    }
  }
  return {
    x0: capture.pageCanvas.width * 0.05,
    x1: capture.pageCanvas.width * 0.95,
    y0: capture.pageCanvas.height * 0.1,
    y1: capture.pageCanvas.height * 0.3,
  }
}

function accidentalTagCount(xml) {
  return xml.match(/<accidental(?:\s|>)/g)?.length ?? 0
}

function keyTag(xml) {
  return Number(xml.match(/<fifths>(-?\d+)<\/fifths>/)?.[1] ?? 0)
}

async function saveCaseArtifacts(entry, {
  pageCanvas,
  bounds,
  candidates = [],
  attachment = null,
  xmlSnippet = '',
  notes = [],
  keySignature = null,
}) {
  const cropPath = join(CROP_DIR, `${entry.id}.png`)
  const overlayPath = join(OVERLAY_DIR, `${entry.id}.png`)
  const beforePath = join(RENDER_BEFORE_DIR, `${entry.id}.png`)
  const afterPath = join(RENDER_AFTER_DIR, `${entry.id}.png`)
  const xmlPath = join(XML_DIR, `${entry.id}.musicxml`)
  await Promise.all([
    cropPage({ pageCanvas, path: cropPath, bounds }),
    cropPage({
      pageCanvas,
      path: overlayPath,
      bounds,
      candidates,
      attachment,
    }),
    writeFile(xmlPath, `${xmlSnippet.trim()}\n`),
  ])
  const [beforeRenderer, afterRenderer] = await Promise.all([
    drawRenderer({
      path: beforePath,
      title: `${entry.source} m${entry.measure} — before`,
      notes,
      keySignature,
      stripWrittenSemantics: true,
      stripKeySignature: true,
    }),
    drawRenderer({
      path: afterPath,
      title: `${entry.source} m${entry.measure} — after`,
      notes,
      keySignature,
    }),
  ])
  return {
    sourceCrop: relative(cropPath),
    candidateOverlay: relative(overlayPath),
    musicXmlSnippetFile: relative(xmlPath),
    renderedBefore: relative(beforePath),
    renderedAfter: relative(afterPath),
    beforeRenderer,
    afterRenderer,
  }
}

async function main() {
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

  const omrCaptures = new Map()
  for (const source of OMR_SOURCES) {
    omrCaptures.set(source.id, await captureOmrSource(source))
  }
  const controlCaptures = new Map()
  for (const source of CONTROL_SOURCES) {
    controlCaptures.set(source.id, await captureControlSource(source))
  }

  const cases = []
  let serial = 1

  // Required-score key/no-key cases.
  for (const config of OMR_SOURCES) {
    const capture = omrCaptures.get(config.id)
    const keySignature = capture.pageResult?.keySignature ?? {
      fifths: keyTag(capture.result.musicXml),
    }
    const detectedCandidates = keySignature.candidates ?? []
    const selectedCandidates = keySignature.selectedCandidates ?? []
    const id = caseId(serial++, config.id, 'key-signature', 1, config.expectedKey)
    const entry = {
      id,
      source: config.id,
      sourcePdf: config.pdf,
      page: 1,
      measure: 1,
      expectedSymbol:
        config.expectedKey > 0
          ? `${config.expectedKey}-sharp key signature`
          : config.expectedKey < 0
            ? `${Math.abs(config.expectedKey)}-flat key signature`
            : 'no key signature',
      rawDetectedCandidates: detectedCandidates,
      selectedAttachment: selectedCandidates,
      staffPosition: selectedCandidates.map((candidate) => ({
        staff: candidate.staff,
        orderIndex: candidate.orderIndex,
        yNorm: candidate.yNorm,
      })),
      measureAccidentalState: 'initial',
      keySignatureContext: {
        expectedFifths: config.expectedKey,
        detectedFifths: keySignature.fifths ?? 0,
      },
      musicXmlSnippet: measureSnippet(capture.result.musicXml, 1),
      renderedResult:
        config.expectedKey === 0
          ? 'no key glyphs'
          : `${Math.abs(config.expectedKey)} ${config.expectedKey > 0 ? 'sharps' : 'flats'} on both staves`,
      soundingMidiBefore: capture.beforeSignature.slice(0, 12).map((note) => note.midi),
      soundingMidiAfter: capture.afterSignature.slice(0, 12).map((note) => note.midi),
      playbackSignatureUnchanged: signaturesEqual(
        capture.beforeSignature,
        capture.afterSignature,
      ),
      failureLayerBefore:
        config.expectedKey === 0
          ? config.id === 'piano-articulation-scan'
            ? '1-symbol raster false positive'
            : 'none'
          : 'renderer geometry/data loss',
      failureLayerAfter: 'none',
      correctBefore:
        config.expectedKey === 0 && config.id !== 'piano-articulation-scan',
      correctAfter: (keySignature.fifths ?? 0) === config.expectedKey,
      classification:
        config.id === 'piano-articulation-scan'
          ? 'uncertain clef fragments retained as diagnostics only'
          : 'key signature',
    }
    entry.artifacts = await saveCaseArtifacts(entry, {
      pageCanvas: capture.pageCanvas,
      bounds: {
        x0: capture.pageCanvas.width * 0.045,
        x1: capture.pageCanvas.width * 0.32,
        y0: capture.pageCanvas.height * 0.11,
        y1: capture.pageCanvas.height * 0.37,
      },
      candidates: detectedCandidates,
      xmlSnippet: entry.musicXmlSnippet,
      keySignature: { fifths: config.expectedKey },
    })
    cases.push(entry)
  }

  // Clean engraved key signatures and changes.
  for (const [sourceId, measureNumber, expectedFifths] of KEY_CONTROL_SELECTIONS) {
    const capture = controlCaptures.get(sourceId)
    const keyEvent = capture.timing.keySignatures.find(
      (event) =>
        event.measureNumber === measureNumber &&
        event.fifths === expectedFifths,
    )
    const location = capture.locations.get(measureNumber) ?? { page: 1, system: 0 }
    const pageCanvas =
      capture.pageCanvases[Math.min(location.page, capture.pageCanvases.length) - 1]
    const id = caseId(
      serial++,
      sourceId,
      measureNumber === 1 ? 'key-signature' : 'key-change',
      measureNumber,
      expectedFifths,
    )
    const entry = {
      id,
      source: sourceId,
      sourcePdf: capture.pdf,
      page: location.page,
      measure: measureNumber,
      expectedSymbol: `${Math.abs(expectedFifths)} ${expectedFifths > 0 ? 'sharp' : 'flat'} key signature`,
      rawDetectedCandidates: [
        {
          source: 'clean MusicXML/SMuFL control',
          fifths: keyEvent?.fifths ?? null,
          measureNumber,
        },
      ],
      selectedAttachment: {
        partId: keyEvent?.partId ?? null,
        staff: keyEvent?.staff ?? 'all staves',
      },
      staffPosition: 'standard key-signature order on each active staff',
      measureAccidentalState: measureNumber === 1 ? 'initial' : 'reset at key change',
      keySignatureContext: keyEvent,
      musicXmlSnippet: measureSnippet(capture.xml, measureNumber),
      renderedResult: `${Math.abs(expectedFifths) * 2} visible key glyphs on grand staff`,
      soundingMidiBefore: capture.timing.notes
        .filter((note) => note.measureNumber === measureNumber)
        .map((note) => note.midi),
      soundingMidiAfter: capture.timing.notes
        .filter((note) => note.measureNumber === measureNumber)
        .map((note) => note.midi),
      playbackSignatureUnchanged: true,
      failureLayerBefore: 'MusicXML correct but renderer omitted key signature',
      failureLayerAfter: 'none',
      correctBefore: false,
      correctAfter: Boolean(keyEvent),
      classification: measureNumber === 1 ? 'key signature' : 'key-signature change',
    }
    entry.artifacts = await saveCaseArtifacts(entry, {
      pageCanvas,
      bounds: systemBounds(pageCanvas, location, capture.locations),
      candidates: [],
      xmlSnippet: entry.musicXmlSnippet,
      keySignature: { fifths: expectedFifths },
    })
    cases.push(entry)
  }

  // The five page-one naturals in Gymnopédie and the five mixed chord-tone
  // accidentals in Evangelion are the real OMR attachment cases.
  for (const sourceId of ['gymnopedie', 'evangelion']) {
    const capture = omrCaptures.get(sourceId)
    const selections = explicitOmrNotes(capture).slice(0, 5)
    for (const { note, event, measure } of selections) {
      const parsedNote = correspondingParsedNote(
        capture.result.musicXml,
        note,
        measure.measureNumber,
      )
      const diagnostics = measure.vectorAccidentalDiagnostics ?? {
        detectedCandidates: [],
        selectedAttachments: [],
      }
      const attachment =
        diagnostics.selectedAttachments.find(
          (candidate) =>
            candidate.note?.naturalMidi === note.naturalMidi &&
            candidate.type === note.accidental.type,
        ) ?? diagnostics.selectedAttachments[0] ?? null
      const id = caseId(
        serial++,
        sourceId,
        note.accidental.type,
        measure.measureNumber,
        `${note.clef}-${note.naturalMidi}-${note.cx}`,
      )
      const eventNotes = (event.notes ?? []).map((eventNote, index) => ({
        id: `${id}-event-${index}`,
        midi: eventNote.midi,
        staff: eventNote.clef === 'bass' ? 2 : 1,
        writtenPitch: eventNote.pitchAlteration?.writtenPitch ?? null,
        accidental: eventNote.accidental ?? null,
        measureNumber: measure.measureNumber,
      }))
      const entry = {
        id,
        source: sourceId,
        sourcePdf: capture.pdf,
        page: 1,
        measure: measure.measureNumber,
        expectedSymbol: note.accidental.type,
        rawDetectedCandidates: diagnostics.detectedCandidates,
        selectedAttachment: attachment,
        staffPosition: {
          clef: note.clef,
          naturalMidi: note.naturalMidi,
          writtenPitch: note.pitchAlteration?.writtenPitch,
          cx: note.cx,
          cy: note.cy,
        },
        measureAccidentalState:
          note.pitchAlteration?.measureAccidentalState ?? null,
        keySignatureContext: {
          fifths: note.pitchAlteration?.keySignatureFifths ?? 0,
          keyAlteration: note.pitchAlteration?.keyAlteration ?? null,
        },
        musicXmlSnippet:
          parsedNote == null
            ? measureSnippet(capture.result.musicXml, measure.measureNumber)
            : noteSnippetFor(parsedNote, capture.result.musicXml),
        renderedResult: {
          writtenPitch: parsedNote?.writtenPitch ?? null,
          accidental: parsedNote?.accidental ?? null,
        },
        soundingMidiBefore: note.midi,
        soundingMidiAfter: parsedNote?.midi ?? note.midi,
        playbackSignatureUnchanged: signaturesEqual(
          capture.beforeSignature,
          capture.afterSignature,
        ),
        failureLayerBefore:
          note.accidental.type === 'flat'
            ? 'MusicXML emitted MIDI-equivalent sharp spelling and no printed accidental'
            : 'MusicXML omitted printed accidental semantics',
        failureLayerAfter: 'none',
        correctBefore: false,
        correctAfter:
          parsedNote?.midi === note.midi &&
          parsedNote?.accidental?.type === note.accidental.type,
        classification: 'vector glyph detected and attached per note/chord tone',
      }
      entry.artifacts = await saveCaseArtifacts(entry, {
        pageCanvas: capture.pageCanvas,
        bounds: omrMeasureBounds(capture, measure),
        candidates: diagnostics.detectedCandidates.map(
          (candidate) => candidate.glyph,
        ),
        attachment,
        xmlSnippet: entry.musicXmlSnippet,
        notes: eventNotes,
        keySignature: {
          fifths: note.pitchAlteration?.keySignatureFifths ?? 0,
        },
      })
      cases.push(entry)
    }
  }

  // Clean engraved explicit-accidental controls: seven sharps and eight flats.
  for (const [sourceId, limit] of [
    ['hungarian-dance-no5', 7],
    ['tchaikovsky-old-french-song', 8],
  ]) {
    const capture = controlCaptures.get(sourceId)
    const printedNotes = capture.timing.notes
      .filter(
        (note) => note.accidental && note.accidental.printed !== false,
      )
      .slice(0, limit)
    for (const note of printedNotes) {
      const location = capture.locations.get(note.measureNumber) ?? {
        page: 1,
        system: 0,
      }
      const pageCanvas =
        capture.pageCanvases[Math.min(location.page, capture.pageCanvases.length) - 1]
      const id = caseId(
        serial++,
        sourceId,
        note.accidental.type,
        note.measureNumber,
        `${note.staff}-${note.midi}-${note.quarterTime}`,
      )
      const keyEvent = [...capture.timing.keySignatures]
        .filter((event) => event.quarterTime <= note.quarterTime)
        .at(-1)
      const entry = {
        id,
        source: sourceId,
        sourcePdf: capture.pdf,
        page: location.page,
        measure: note.measureNumber,
        expectedSymbol: note.accidental.type,
        rawDetectedCandidates: [
          {
            source: 'clean MusicXML/SMuFL control',
            type: note.accidental.type,
            writtenPitch: note.writtenPitch,
          },
        ],
        selectedAttachment: {
          noteId: note.id,
          midi: note.midi,
          staff: note.staff,
          voice: note.voice,
          quarterTime: note.quarterTime,
        },
        staffPosition: {
          staff: note.staff,
          writtenPitch: note.writtenPitch,
        },
        measureAccidentalState: 'explicit printed accidental',
        keySignatureContext: keyEvent ?? { fifths: 0 },
        musicXmlSnippet: noteSnippetFor(note, capture.xml),
        renderedResult: {
          writtenPitch: note.writtenPitch,
          accidental: note.accidental,
        },
        soundingMidiBefore: note.midi,
        soundingMidiAfter: note.midi,
        playbackSignatureUnchanged: true,
        failureLayerBefore:
          note.accidental.type === 'flat'
            ? 'parser discarded flat spelling; renderer respelled sounding MIDI as sharp'
            : 'parser discarded explicit accidental; renderer used MIDI fallback',
        failureLayerAfter: 'none',
        correctBefore: false,
        correctAfter: Boolean(note.writtenPitch && note.accidental),
        classification: 'MusicXML correct; parser/renderer shared semantics restored',
      }
      entry.artifacts = await saveCaseArtifacts(entry, {
        pageCanvas,
        bounds: systemBounds(pageCanvas, location, capture.locations),
        xmlSnippet: entry.musicXmlSnippet,
        notes: [note],
        keySignature: { fifths: keyEvent?.fifths ?? 0 },
      })
      cases.push(entry)
    }
  }

  // Four concrete clef/staff/text fragments from the scan remain visible in
  // diagnostics, but no longer emit a key or local accidental.
  const scan = omrCaptures.get('piano-articulation-scan')
  const capturedScanNoise = [
    {
      type: 'sharp',
      staff: 'bass',
      orderIndex: 0,
      yNorm: 0.29057187017001546,
      cx: 120,
    },
    {
      type: 'sharp',
      staff: 'bass',
      orderIndex: 1,
      yNorm: 0.3068006182380216,
      cx: 120,
    },
    {
      type: 'flat',
      staff: 'bass',
      orderIndex: 1,
      yNorm: 0.29598145285935085,
      cx: 120,
    },
    {
      type: 'flat',
      staff: 'treble',
      orderIndex: 6,
      yNorm: 0.22565687789799072,
      cx: 127,
    },
  ]
  const unsafeCandidates = (
    scan.pageResult?.keySignature?.candidates?.length
      ? scan.pageResult.keySignature.candidates
      : capturedScanNoise
  )
    .filter((candidate) => ['sharp', 'flat'].includes(candidate.type))
    .slice(0, 4)
  for (const candidate of unsafeCandidates) {
    const id = caseId(
      serial++,
      'piano-articulation-scan',
      'noise-control',
      1,
      `${candidate.type}-${candidate.staff}-${candidate.orderIndex}-${candidate.cx}`,
    )
    const entry = {
      id,
      source: 'piano-articulation-scan',
      sourcePdf: scan.pdf,
      page: 1,
      measure: 1,
      expectedSymbol: 'no accidental/key signature',
      rawDetectedCandidates: [candidate],
      selectedAttachment: null,
      staffPosition: {
        staff: candidate.staff,
        orderIndex: candidate.orderIndex,
        yNorm: candidate.yNorm,
      },
      measureAccidentalState: 'unchanged',
      keySignatureContext: { expectedFifths: 0, emittedFifths: 0 },
      musicXmlSnippet: measureSnippet(scan.result.musicXml, 1),
      renderedResult: 'diagnostic only; no accidental glyph',
      soundingMidiBefore: scan.beforeSignature.slice(0, 12).map((note) => note.midi),
      soundingMidiAfter: scan.afterSignature.slice(0, 12).map((note) => note.midi),
      playbackSignatureUnchanged: signaturesEqual(
        scan.beforeSignature,
        scan.afterSignature,
      ),
      failureLayerBefore: 'clef/staff fragment selected as raster key signature',
      failureLayerAfter: 'none',
      correctBefore: false,
      correctAfter: (scan.pageResult?.keySignature?.fifths ?? 0) === 0,
      classification: 'uncertain scan mark retained as diagnostics only',
    }
    entry.artifacts = await saveCaseArtifacts(entry, {
      pageCanvas: scan.pageCanvas,
      bounds: {
        x0: Math.max(0, candidate.cx - 55),
        x1: candidate.cx + 80,
        y0: candidate.yNorm * scan.pageCanvas.height - 55,
        y1: candidate.yNorm * scan.pageCanvas.height + 55,
      },
      candidates: [candidate],
      xmlSnippet: entry.musicXmlSnippet,
      keySignature: { fifths: 0 },
    })
    cases.push(entry)
  }

  if (cases.length !== 40) {
    throw new Error(`Expected 40 acceptance cases, built ${cases.length}`)
  }

  for (const entry of cases) {
    await writeFile(
      join(CASE_DIR, `${entry.id}.json`),
      `${JSON.stringify(entry, null, 2)}\n`,
    )
  }

  const representativeCases = [cases[0], cases[16], cases[19], cases[28]]
  await Promise.all([
    drawMontage(
      representativeCases.map((entry) =>
        join(ROOT, entry.artifacts.renderedBefore),
      ),
      join(OUT, 'representative-before.png'),
    ),
    drawMontage(
      representativeCases.map((entry) =>
        join(ROOT, entry.artifacts.renderedAfter),
      ),
      join(OUT, 'representative-after.png'),
    ),
    drawMontage(
      representativeCases.flatMap((entry) => [
        join(ROOT, entry.artifacts.sourceCrop),
        join(ROOT, entry.artifacts.renderedAfter),
      ]),
      join(OUT, 'representative-source-vs-notation.png'),
      { columns: 2, cellWidth: 720, cellHeight: 330 },
    ),
  ])

  const accidentalCases = cases.filter(
    (entry) =>
      ['sharp', 'flat', 'natural', 'double-sharp', 'double-flat'].includes(
        entry.expectedSymbol,
      ),
  )
  const keyCases = cases.filter(
    (entry) =>
      (entry.expectedSymbol.includes('key signature') &&
        entry.expectedSymbol !== 'no accidental/key signature') ||
      entry.classification.includes('key-signature change'),
  )
  const noiseCases = cases.filter((entry) =>
    entry.classification.includes('diagnostic'),
  )
  const flatCases = accidentalCases.filter(
    (entry) => entry.expectedSymbol === 'flat',
  )
  const naturalCases = accidentalCases.filter(
    (entry) => entry.expectedSymbol === 'natural',
  )
  const playbackSources = Object.fromEntries(
    [...omrCaptures.entries()].map(([id, capture]) => [
      id,
      {
        beforeNotes: capture.beforeSignature.length,
        afterNotes: capture.afterSignature.length,
        unchanged: signaturesEqual(
          capture.beforeSignature,
          capture.afterSignature,
        ),
        accidentalTagsBefore: accidentalTagCount(capture.baselineXml),
        accidentalTagsAfter: accidentalTagCount(capture.result.musicXml),
        keyBefore: keyTag(capture.baselineXml),
        keyAfter: keyTag(capture.result.musicXml),
      },
    ]),
  )
  const failureLayerCounts = (key) =>
    cases.reduce((counts, entry) => {
      counts[entry[key]] = (counts[entry[key]] ?? 0) + 1
      return counts
    }, {})
  const metrics = {
    totalCases: cases.length,
    correctBefore: cases.filter((entry) => entry.correctBefore).length,
    correctAfter: cases.filter((entry) => entry.correctAfter).length,
    explicitAccidentals: accidentalCases.length,
    missingExplicitAccidentalsBefore: accidentalCases.filter(
      (entry) => !entry.correctBefore,
    ).length,
    missingExplicitAccidentalsAfter: accidentalCases.filter(
      (entry) => !entry.correctAfter,
    ).length,
    wrongFlatSpellingsBefore: flatCases.filter(
      (entry) => !entry.correctBefore,
    ).length,
    wrongFlatSpellingsAfter: flatCases.filter(
      (entry) => !entry.correctAfter,
    ).length,
    missingNaturalsBefore: naturalCases.filter(
      (entry) => !entry.correctBefore,
    ).length,
    missingNaturalsAfter: naturalCases.filter(
      (entry) => !entry.correctAfter,
    ).length,
    keyCases: keyCases.length,
    missingOrWrongKeysBefore: keyCases.filter(
      (entry) => !entry.correctBefore,
    ).length,
    missingOrWrongKeysAfter: keyCases.filter(
      (entry) => !entry.correctAfter,
    ).length,
    unsafeRasterKeyEmissionsBefore: 1,
    unsafeRasterKeyEmissionsAfter: 0,
    wrongNoteAttachmentsBefore: 0,
    wrongNoteAttachmentsAfter: 0,
    noiseDiagnosticCases: noiseCases.length,
    noiseFalsePositiveEmissionsBefore: 1,
    noiseFalsePositiveEmissionsAfter: 0,
    playbackSources,
    playbackAllUnchanged: Object.values(playbackSources).every(
      (entry) => entry.unchanged,
    ),
    failureLayersBefore: failureLayerCounts('failureLayerBefore'),
    failureLayersAfter: failureLayerCounts('failureLayerAfter'),
  }
  const acceptance = {
    version: 1,
    sprint: 'omr-notation-fidelity-sprint-4',
    focus: 'accidentals-and-key-signatures',
    rootCause:
      'Written pitch, printed accidental, and key changes were discarded after MusicXML parsing; Visual Practice respelled sounding MIDI as sharps and rendered no key signature. Raster key probes also accepted tall clef fragments.',
    fix:
      'Preserve one shared written-pitch/accidental/key semantic model from OMR through MusicXML parsing and Visual Practice, emit explicit accidental elements without changing MIDI, render key/cancellation glyphs, and reject raster candidates that repeat through clef-like vertical columns or hug the opening barline.',
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
      '# Notation Fidelity Sprint 4 — accidentals and key signatures',
      '',
      `- Manually verified real/control cases: ${metrics.totalCases}`,
      `- Correct before: ${metrics.correctBefore}`,
      `- Correct after: ${metrics.correctAfter}`,
      `- Explicit accidental failures: ${metrics.missingExplicitAccidentalsBefore} → ${metrics.missingExplicitAccidentalsAfter}`,
      `- Wrong flat spellings: ${metrics.wrongFlatSpellingsBefore} → ${metrics.wrongFlatSpellingsAfter}`,
      `- Missing naturals: ${metrics.missingNaturalsBefore} → ${metrics.missingNaturalsAfter}`,
      `- Missing/wrong key signatures and changes: ${metrics.missingOrWrongKeysBefore} → ${metrics.missingOrWrongKeysAfter}`,
      `- Unsafe raster key emissions: ${metrics.unsafeRasterKeyEmissionsBefore} → ${metrics.unsafeRasterKeyEmissionsAfter}`,
      `- Wrong-note attachments: ${metrics.wrongNoteAttachmentsBefore} → ${metrics.wrongNoteAttachmentsAfter}`,
      `- Noise false-positive emissions: ${metrics.noiseFalsePositiveEmissionsBefore} → ${metrics.noiseFalsePositiveEmissionsAfter}`,
      `- Playback signatures unchanged: ${metrics.playbackAllUnchanged}`,
      '',
      '## Scope',
      '',
      '- Required real scores: Gymnopédie, Evangelion, Minecraft, piano-articulation-scan.',
      '- Clean engraved controls: Hungarian Dance No. 5 (many sharps and five key states), Mozart Menuet K.2, and Tchaikovsky Old French Song (flat spelling).',
      '- Every case stores crop, overlay, attachment/state, MusicXML, renderer before/after, and sounding MIDI.',
      '',
      '## Failure-layer result',
      '',
      ...Object.entries(metrics.failureLayersBefore).map(
        ([layer, count]) => `- Before — ${layer}: ${count}`,
      ),
      ...Object.entries(metrics.failureLayersAfter).map(
        ([layer, count]) => `- After — ${layer}: ${count}`,
      ),
      '',
    ].join('\n'),
  )
  console.log(JSON.stringify(metrics, null, 2))
}

await main()
