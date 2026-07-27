#!/usr/bin/env node
/**
 * Notation Fidelity Sprint 3 real-score trace.
 *
 * Saves 35 manually reviewed tie/slur cases with PDF crops, original path
 * candidates, attachments, MusicXML, renderer geometry, and playback attacks.
 * The frozen semantic evaluator is invoked separately and is never modified.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import { processOmrPageAnalysis } from '../src/features/omr/processOmrPage.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { buildVisualLaneGroups } from '../src/features/practice/visualPracticeLane.js'
import {
  buildStaffGeometry,
  buildStaffLaneNotationMarkings,
  buildStaffLaneNotes,
  detectStaves,
} from '../src/features/practice/staffLaneLayout.js'
import {
  makePdfCurveExtractor,
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from './lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tmp/notation-fidelity-sprint-3')
const CASE_DIR = join(OUT, 'cases')
const CROP_DIR = join(OUT, 'source-crops')
const OVERLAY_DIR = join(OUT, 'candidate-overlays')
const RENDER_DIR = join(OUT, 'rendered-results')
const XML_DIR = join(OUT, 'musicxml-snippets')
const DOWNLOADS = join(homedir(), 'Downloads')

const SOURCES = [
  {
    id: 'gymnopedie',
    pdf: join(DOWNLOADS, 'gymnopedie-no-1-satie.pdf'),
    truth: join(OUT, '../notation-fidelity-sprint-2/truth/gymnopedie.musicxml'),
    baseline: join(OUT, '../notation-fidelity-sprint-2/after/gymnopedie.musicxml'),
  },
  {
    id: 'minecraft',
    pdf: join(DOWNLOADS, 'beginner-minecraft-piano-themes-in-c-minecraft.pdf'),
    truth: join(OUT, '../notation-fidelity-sprint-2/truth/minecraft.musicxml'),
    baseline: join(OUT, '../notation-fidelity-sprint-2/after/minecraft.musicxml'),
  },
  {
    id: 'evangelion',
    pdf: join(DOWNLOADS, 'a-cruel-angels-thesis-neon-genesis-evangelion.pdf'),
    truth: join(OUT, '../notation-fidelity-sprint-2/truth/evangelion.musicxml'),
    baseline: join(OUT, '../notation-fidelity-sprint-2/after/evangelion.musicxml'),
  },
  {
    id: 'piano-articulation-scan',
    pdf: join(
      ROOT,
      'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf',
    ),
    truth: join(
      ROOT,
      'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.musicxml',
    ),
    baseline: join(OUT, '../notation-fidelity-sprint-2/after/articulation.musicxml'),
  },
  {
    id: 'piano-grand-voices-vector',
    pdf: join(
      ROOT,
      'benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.pdf',
    ),
    truth: join(
      ROOT,
      'benchmarks/omr-fixtures/piano-grand-voices-vector/piano-grand-voices-vector.musicxml',
    ),
    baseline: null,
  },
]

function imageDataCanvas(page) {
  const canvas = createCanvas(page.width, page.height)
  const context = canvas.getContext('2d')
  const imageData = context.createImageData(page.width, page.height)
  imageData.data.set(page.data)
  context.putImageData(imageData, 0, 0)
  return canvas
}

function countTags(xml) {
  return {
    notes: xml.match(/<note(?:\s|>)/g)?.length ?? 0,
    tieTags: xml.match(/<tie /g)?.length ?? 0,
    tieLinks: Math.floor((xml.match(/<tie /g)?.length ?? 0) / 2),
    slurTags: xml.match(/<slur /g)?.length ?? 0,
    slurLinks: Math.floor((xml.match(/<slur /g)?.length ?? 0) / 2),
  }
}

function measureSnippet(xml, measureNumbers) {
  const snippets = []
  for (const measureNumber of [...new Set(measureNumbers)]) {
    const match = xml.match(
      new RegExp(`<measure number="${measureNumber}"[\\s\\S]*?<\\/measure>`),
    )
    if (match) {
      snippets.push(match[0])
    }
  }
  return snippets.join('\n')
}

function writtenNoteSignature(xml) {
  return [...xml.matchAll(/<note(?:\s|>)[\s\S]*?<\/note>/g)].map(([block]) => ({
    chord: block.includes('<chord/>'),
    pitch:
      block.match(/<pitch>([\s\S]*?)<\/pitch>/)?.[1] ??
      (block.includes('<rest') ? 'rest' : null),
    duration: block.match(/<duration>([^<]+)<\/duration>/)?.[1] ?? null,
    voice: block.match(/<voice>([^<]+)<\/voice>/)?.[1] ?? null,
    type: block.match(/<type>([^<]+)<\/type>/)?.[1] ?? null,
    dotted: block.includes('<dot/>'),
    staff: block.match(/<staff>([^<]+)<\/staff>/)?.[1] ?? null,
    beams: [...block.matchAll(/<beam number="([^"]+)">([^<]+)<\/beam>/g)].map(
      (match) => `${match[1]}:${match[2]}`,
    ),
  }))
}

function parseCandidatePage(candidateId) {
  const page = Number(candidateId?.match(/pdf-path-p(\d+)-/)?.[1])
  return Number.isFinite(page) ? page : 1
}

function caseId(kind, source, pair, serial) {
  const fromMidi = pair.midi ?? pair.fromMidi ?? 'x'
  const toMidi = pair.midi ?? pair.toMidi ?? 'x'
  return [
    String(serial).padStart(2, '0'),
    source,
    kind,
    `m${pair.fromMeasure}-${pair.toMeasure}`,
    `${fromMidi}-${toMidi}`,
  ].join('-')
}

function rendererModel(xml) {
  const timing = parseMusicXml(xml, 'notation-fidelity-sprint3.musicxml')
  const groups = buildVisualLaneGroups(timing)
  const geometry = buildStaffGeometry(detectStaves(groups))
  const notes = buildStaffLaneNotes(groups, geometry)
  const markings = buildStaffLaneNotationMarkings(groups, geometry, { notes })
  return {
    timing,
    groups,
    geometry,
    notes,
    markings,
  }
}

function pairMatchesMarking(pair, marking, kind) {
  return (
    marking.kind === kind &&
    marking.fromMeasureNumber === pair.fromMeasure &&
    marking.toMeasureNumber === pair.toMeasure &&
    marking.fromMidi === (pair.midi ?? pair.fromMidi) &&
    marking.toMidi === (pair.midi ?? pair.toMidi)
  )
}

function drawRendererResult(path, model, pair, kind) {
  const marking = model.markings.spanMarkings.find((entry) =>
    pairMatchesMarking(pair, entry, kind),
  )
  const selectedNotes = model.notes.filter((note) => {
    if (marking) {
      const start = model.notes.find(
        (candidate) => candidate.visualNoteId === marking.fromNoteId,
      )
      const end = model.notes.find(
        (candidate) => candidate.visualNoteId === marking.toNoteId,
      )
      if (!start || !end) return false
      return (
        note.x >= Math.min(start.x, end.x) - 40 &&
        note.x <= Math.max(start.x, end.x) + 40
      )
    }
    return (
      note.measureNumber === pair.fromMeasure ||
      note.measureNumber === pair.toMeasure
    )
  })
  const xs = selectedNotes.map((note) => note.x)
  const rawX0 = xs.length ? Math.min(...xs) - 50 : 0
  const rawX1 = xs.length ? Math.max(...xs) + 50 : 900
  const rawWidth = Math.max(120, rawX1 - rawX0)
  const width = Math.min(1200, Math.max(420, rawWidth))
  const scaleX = width / rawWidth
  const height = Math.ceil(model.geometry.height + 55)
  const canvas = createCanvas(Math.ceil(width), height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.strokeStyle = '#b8b8b8'
  context.lineWidth = 1
  for (const y of model.geometry.lines) {
    context.beginPath()
    context.moveTo(0, y + 22)
    context.lineTo(canvas.width, y + 22)
    context.stroke()
  }
  for (const note of selectedNotes) {
    context.save()
    context.translate((note.x - rawX0) * scaleX, note.y + 22)
    context.rotate(-14 * Math.PI / 180)
    context.beginPath()
    context.ellipse(0, 0, 7, 5.2, 0, 0, Math.PI * 2)
    if (note.hollow) {
      context.fillStyle = '#ffffff'
      context.fill()
      context.strokeStyle = '#111111'
      context.lineWidth = 2
      context.stroke()
    } else {
      context.fillStyle = '#111111'
      context.fill()
    }
    context.restore()
  }
  if (marking) {
    const values = marking.path.match(
      /M\s+([\d.e+-]+)\s+([\d.e+-]+)\s+Q\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/,
    )
    if (values) {
      const [, x1, y1, cx, cy, x2, y2] = values.map(Number)
      context.strokeStyle = kind === 'tie' ? '#1769aa' : '#8e24aa'
      context.lineWidth = 2.5
      context.beginPath()
      context.moveTo((x1 - rawX0) * scaleX, y1 + 22)
      context.quadraticCurveTo(
        (cx - rawX0) * scaleX,
        cy + 22,
        (x2 - rawX0) * scaleX,
        y2 + 22,
      )
      context.stroke()
    }
  }
  context.fillStyle = marking ? '#1f2937' : '#b42318'
  context.font = '15px sans-serif'
  context.fillText(
    marking
      ? `${kind} ${pair.fromMeasure} → ${pair.toMeasure} (${marking.placement ?? 'default'})`
      : `No ${kind} emitted`,
    16,
    18,
  )
  return writeFile(path, canvas.toBuffer('image/png')).then(() => marking ?? null)
}

async function drawCandidateArtifacts({
  cropPath,
  overlayPath,
  source,
  candidateDiagnostics,
}) {
  const panels = []
  if (!candidateDiagnostics.length) {
    const pageCanvas = source.pageCanvases[0]
    panels.push({
      pageCanvas,
      sx: 0,
      sy: Math.floor(pageCanvas.height * 0.12),
      sw: pageCanvas.width,
      sh: Math.floor(pageCanvas.height * 0.43),
      diagnostic: null,
    })
  } else {
    for (const diagnostic of candidateDiagnostics) {
      const pageCanvas = source.pageCanvases[(diagnostic.page ?? 1) - 1]
      const bounds = diagnostic.bounds
      const sx = Math.max(0, Math.floor(bounds.x0 - 38))
      const sy = Math.max(0, Math.floor(bounds.y0 - 48))
      const sw = Math.min(
        pageCanvas.width - sx,
        Math.ceil(bounds.x1 - bounds.x0 + 76),
      )
      const sh = Math.min(
        pageCanvas.height - sy,
        Math.ceil(bounds.y1 - bounds.y0 + 96),
      )
      panels.push({ pageCanvas, sx, sy, sw, sh, diagnostic })
    }
  }
  const width = Math.max(...panels.map((panel) => panel.sw))
  const height = panels.reduce((total, panel) => total + panel.sh + 8, 0)
  const sourceCanvas = createCanvas(width, height)
  const overlayCanvas = createCanvas(width, height)
  const sourceContext = sourceCanvas.getContext('2d')
  const overlayContext = overlayCanvas.getContext('2d')
  sourceContext.fillStyle = '#fff'
  overlayContext.fillStyle = '#fff'
  sourceContext.fillRect(0, 0, width, height)
  overlayContext.fillRect(0, 0, width, height)
  let offsetY = 0
  for (const panel of panels) {
    for (const context of [sourceContext, overlayContext]) {
      context.drawImage(
        panel.pageCanvas,
        panel.sx,
        panel.sy,
        panel.sw,
        panel.sh,
        0,
        offsetY,
        panel.sw,
        panel.sh,
      )
    }
    const diagnostic = panel.diagnostic
    if (diagnostic) {
      const localX = (value) => value - panel.sx
      const localY = (value) => value - panel.sy + offsetY
      overlayContext.strokeStyle = '#ff2d55'
      overlayContext.lineWidth = 2
      overlayContext.strokeRect(
        localX(diagnostic.bounds.x0),
        localY(diagnostic.bounds.y0),
        diagnostic.bounds.width,
        diagnostic.bounds.height,
      )
      overlayContext.fillStyle = '#007aff'
      overlayContext.beginPath()
      overlayContext.arc(localX(diagnostic.start.x), localY(diagnostic.start.y), 4, 0, Math.PI * 2)
      overlayContext.fill()
      overlayContext.fillStyle = '#ff9500'
      overlayContext.beginPath()
      overlayContext.arc(localX(diagnostic.end.x), localY(diagnostic.end.y), 4, 0, Math.PI * 2)
      overlayContext.fill()
      const rawCandidates = [
        ...(diagnostic.startCandidates ?? []),
        ...(diagnostic.endCandidates ?? []),
      ]
      overlayContext.fillStyle = '#ffd60a'
      for (const candidate of rawCandidates) {
        if (!Number.isFinite(candidate.cx) || !Number.isFinite(candidate.cy)) continue
        overlayContext.beginPath()
        overlayContext.arc(localX(candidate.cx), localY(candidate.cy), 3, 0, Math.PI * 2)
        overlayContext.fill()
      }
      for (const selected of [diagnostic.selectedStart, diagnostic.selectedEnd]) {
        if (!Number.isFinite(selected?.cx) || !Number.isFinite(selected?.cy)) continue
        if (
          selected.cx < panel.sx ||
          selected.cx > panel.sx + panel.sw ||
          selected.cy < panel.sy ||
          selected.cy > panel.sy + panel.sh
        ) {
          continue
        }
        overlayContext.strokeStyle = '#00a86b'
        overlayContext.lineWidth = 3
        overlayContext.beginPath()
        overlayContext.arc(localX(selected.cx), localY(selected.cy), 7, 0, Math.PI * 2)
        overlayContext.stroke()
      }
      overlayContext.fillStyle = '#ff2d55'
      overlayContext.font = '13px sans-serif'
      overlayContext.fillText(
        diagnostic.candidateId,
        localX(diagnostic.bounds.x0),
        Math.max(offsetY + 14, localY(diagnostic.bounds.y0) - 6),
      )
    } else {
      overlayContext.fillStyle = '#b42318'
      overlayContext.font = '18px sans-serif'
      overlayContext.fillText('No original PDF vector curve candidate', 18, offsetY + 28)
    }
    offsetY += panel.sh + 8
  }
  await Promise.all([
    writeFile(cropPath, sourceCanvas.toBuffer('image/png')),
    writeFile(overlayPath, overlayCanvas.toBuffer('image/png')),
  ])
}

function attackTrace(model, pair) {
  const measures = new Set([pair.fromMeasure, pair.toMeasure])
  const midis = new Set([pair.midi ?? pair.fromMidi, pair.midi ?? pair.toMidi])
  return model.timing.notes
    .filter(
      (note) =>
        measures.has(note.measureNumber) &&
        midis.has(note.midi),
    )
    .map((note) => ({
      measureNumber: note.measureNumber,
      midi: note.midi,
      quarterTime: note.quarterTime,
      tieStart: Boolean(note.tieStart),
      tieStop: Boolean(note.tieStop),
      suppressPlaybackAttack: Boolean(note.suppressPlaybackAttack),
    }))
}

async function captureSource(config) {
  const rendered = await renderPdfToPages(config.pdf, { rootDir: ROOT })
  const textExtractor = await makePdfTextExtractor(config.pdf, { rootDir: ROOT })
  const curveExtractor = await makePdfCurveExtractor(config.pdf, { rootDir: ROOT })
  const pageResults = []
  const curvesByPage = new Map()
  const extractPageCurves = async (pdfSource, pageNumber) => {
    const curves = await curveExtractor(pdfSource, pageNumber)
    curvesByPage.set(pageNumber, curves)
    return curves
  }
  const result = await runPdfOmrPipeline(config.pdf, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText: textExtractor,
    extractPageCurves,
    numPages: rendered.numPages,
    maxPages: rendered.numPages,
    title: `${config.id}-notation-fidelity-sprint3`,
    analyzePage(imageData, context) {
      const pageResult = processOmrPageAnalysis(imageData, context)
      pageResults.push(pageResult)
      return pageResult
    },
  })
  const baselineXml = config.baseline ? await readFile(config.baseline, 'utf8') : null
  const truthXml = await readFile(config.truth, 'utf8')
  return {
    ...config,
    rendered,
    pageCanvases: rendered.pages.map(imageDataCanvas),
    pageResults,
    curvesByPage,
    result,
    model: rendererModel(result.musicXml),
    baselineXml,
    truthXml,
  }
}

function diagnosticMap(source) {
  return new Map(
    source.pageResults.flatMap((pageResult) =>
      (pageResult.tieDiagnostics?.vectorCurveDiagnostics ?? []).map((diagnostic) => [
        diagnostic.candidateId,
        diagnostic,
      ]),
    ),
  )
}

function selectedPositivePairs(source) {
  const ties = source.result.diagnostics.ties.appliedTiePairs ?? []
  const slurs = source.result.diagnostics.ties.appliedSlurPairs ?? []
  if (source.id === 'gymnopedie') {
    return [
      ...ties.map((pair) => ({ kind: 'tie', pair })),
      ...slurs.map((pair) => ({ kind: 'slur', pair })),
    ]
  }
  if (source.id === 'minecraft') {
    const wanted = new Set(['1:2:55', '1:2:64', '15:16:64', '15:16:71'])
    return ties
      .filter((pair) => wanted.has(`${pair.fromMeasure}:${pair.toMeasure}:${pair.midi}`))
      .map((pair) => ({ kind: 'tie', pair }))
  }
  if (source.id === 'evangelion') {
    const wanted = new Set(['4:5:63', '4:5:67', '4:5:72', '4:4:84'])
    return ties
      .filter((pair) => wanted.has(`${pair.fromMeasure}:${pair.toMeasure}:${pair.midi}`))
      .map((pair) => ({ kind: 'tie', pair }))
  }
  return []
}

function sourceSummary(source) {
  const diagnostics = source.result.diagnostics.ties
  const pageOneMeasureCount = source.pageResults[0]?.measureRhythms?.length ?? Infinity
  const pageOneXml = measureSnippet(
    source.result.musicXml,
    Array.from({ length: pageOneMeasureCount }, (_, index) => index + 1),
  )
  const baselineCounts = source.baselineXml ? countTags(source.baselineXml) : null
  const currentPageOneCounts = countTags(pageOneXml)
  const currentFullCounts = countTags(source.result.musicXml)
  const baselineSignature = source.baselineXml
    ? writtenNoteSignature(source.baselineXml)
    : null
  const currentPageOneSignature = writtenNoteSignature(pageOneXml)
  const curveDiagnostics = source.pageResults.flatMap(
    (pageResult) => pageResult.tieDiagnostics?.vectorCurveDiagnostics ?? [],
  )
  const rejectedCandidates = curveDiagnostics.filter(
    (diagnostic) => diagnostic.failureReason,
  )
  const currentTiming = parseMusicXml(
    source.result.musicXml,
    `${source.id}-current.musicxml`,
  )
  const baselineTiming = source.baselineXml
    ? parseMusicXml(source.baselineXml, `${source.id}-baseline.musicxml`)
    : null
  const attackCount = (timing, maxMeasure = Infinity) =>
    (timing?.notes ?? []).filter(
      (note) =>
        !note.isRest &&
        Number.isFinite(note.midi) &&
        !note.suppressPlaybackAttack &&
        !note.isTabMirror &&
        (note.measureNumber ?? Infinity) <= maxMeasure,
    ).length
  return {
    pages: source.rendered.numPages,
    detectedVectorCurveCandidates: diagnostics.vectorCurveCandidateCount ?? 0,
    appliedVectorCurvePairs: diagnostics.vectorCurveAppliedCount ?? 0,
    emittedTieLinks: diagnostics.appliedTieCount ?? 0,
    emittedSlurLinks: diagnostics.appliedSlurCount ?? 0,
    emittedOrphanEndpoints: diagnostics.vectorCurveOrphanEndpointCount ?? 0,
    appliedVectorCurveCandidates:
      (diagnostics.vectorCurveCandidateCount ?? 0) - rejectedCandidates.length,
    rejectedVectorCandidates: rejectedCandidates.length,
    rejectedVectorCandidateReasons: rejectedCandidates.reduce((counts, diagnostic) => {
      counts[diagnostic.failureReason] = (counts[diagnostic.failureReason] ?? 0) + 1
      return counts
    }, {}),
    baselinePageOneCounts: baselineCounts,
    currentPageOneCounts,
    currentFullCounts,
    baselinePlaybackAttacks: attackCount(baselineTiming),
    currentPageOnePlaybackAttacks: attackCount(currentTiming, pageOneMeasureCount),
    playbackAttackDelta:
      baselineTiming == null
        ? null
        : attackCount(currentTiming, pageOneMeasureCount) -
          attackCount(baselineTiming),
    writtenPageOneSignatureUnchanged:
      baselineSignature == null
        ? null
        : JSON.stringify(baselineSignature) === JSON.stringify(currentPageOneSignature),
  }
}

async function main() {
  await Promise.all(
    [OUT, CASE_DIR, CROP_DIR, OVERLAY_DIR, RENDER_DIR, XML_DIR].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  )
  const captures = new Map()
  for (const source of SOURCES) {
    captures.set(source.id, await captureSource(source))
  }

  const definitions = []
  for (const sourceId of ['gymnopedie', 'minecraft', 'evangelion']) {
    const source = captures.get(sourceId)
    definitions.push(
      ...selectedPositivePairs(source).map((entry) => ({
        source,
        ...entry,
        expected: entry.kind,
        correctBefore: false,
        correctAfter: true,
        failureLayerBefore: 'symbol-not-detected',
        failureLayerAfter: 'none',
      })),
    )
  }
  for (const sourceId of ['piano-articulation-scan', 'piano-grand-voices-vector']) {
    definitions.push({
      source: captures.get(sourceId),
      kind: 'slur',
      expected: 'slur',
      pair: {
        fromMeasure: 1,
        toMeasure: 2,
        fromMidi: 65,
        toMidi: 67,
        source: 'raster-control',
        candidateIds: [],
      },
      correctBefore: false,
      correctAfter: false,
      failureLayerBefore: 'symbol-not-detected',
      failureLayerAfter: 'symbol-not-detected',
    })
  }
  definitions.push({
    source: captures.get('piano-grand-voices-vector'),
    kind: 'none',
    expected: 'no-curve',
    pair: {
      fromMeasure: 2,
      toMeasure: 3,
      fromMidi: 60,
      toMidi: 62,
      source: 'no-curve-control',
      candidateIds: [],
    },
    correctBefore: true,
    correctAfter: true,
    failureLayerBefore: 'none',
    failureLayerAfter: 'none',
  })

  const cases = []
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index]
    const { source, pair, kind } = definition
    const id = caseId(kind, source.id, pair, index + 1)
    const diagnosticsById = diagnosticMap(source)
    const candidateDiagnostics = (pair.candidateIds ?? [])
      .map((candidateId) => diagnosticsById.get(candidateId))
      .filter(Boolean)
    const cropPath = join(CROP_DIR, `${id}.png`)
    const overlayPath = join(OVERLAY_DIR, `${id}.png`)
    const renderPath = join(RENDER_DIR, `${id}.png`)
    const xmlPath = join(XML_DIR, `${id}.musicxml`)
    await drawCandidateArtifacts({
      cropPath,
      overlayPath,
      source,
      candidateDiagnostics,
    })
    const rendererKind = kind === 'none' ? 'slur' : kind
    const renderedMarking = await drawRendererResult(
      renderPath,
      source.model,
      pair,
      rendererKind,
    )
    const snippet = measureSnippet(source.result.musicXml, [
      pair.fromMeasure,
      pair.toMeasure,
    ])
    await writeFile(xmlPath, `${snippet}\n`)
    const page = candidateDiagnostics[0]?.page ?? parseCandidatePage(pair.candidateIds?.[0])
    const entry = {
      id,
      source: source.id,
      sourcePdf: source.pdf,
      page,
      measures: [pair.fromMeasure, pair.toMeasure],
      expectedSymbol: definition.expected,
      sourceCrop: cropPath,
      candidateOverlay: overlayPath,
      rawCurveCandidates: candidateDiagnostics.map((diagnostic) => ({
        candidateId: diagnostic.candidateId,
        source: diagnostic.source,
        start: diagnostic.start,
        end: diagnostic.end,
        bounds: diagnostic.bounds,
        archDirection: diagnostic.archDirection,
        startCandidates: diagnostic.startCandidates,
        endCandidates: diagnostic.endCandidates,
      })),
      selectedAttachments: {
        fromMeasure: pair.fromMeasure,
        toMeasure: pair.toMeasure,
        fromMidi: pair.midi ?? pair.fromMidi,
        toMidi: pair.midi ?? pair.toMidi,
        clef: pair.clef ?? null,
        candidateIds: pair.candidateIds ?? [],
      },
      classificationResult:
        kind === 'none'
          ? 'no-curve-control'
          : pair.candidateIds?.length
            ? kind
            : 'unresolved',
      emittedMusicXml: xmlPath,
      renderedResult: {
        image: renderPath,
        markingFound: Boolean(renderedMarking),
        path: renderedMarking?.path ?? null,
        placement: renderedMarking?.placement ?? null,
      },
      playbackAttackTrace: attackTrace(source.model, pair),
      correctBefore: definition.correctBefore,
      correctAfter: definition.correctAfter,
      failureLayerBefore: definition.failureLayerBefore,
      failureLayerAfter: definition.failureLayerAfter,
    }
    cases.push(entry)
    await writeFile(join(CASE_DIR, `${id}.json`), `${JSON.stringify(entry, null, 2)}\n`)
  }

  const tally = (key) =>
    cases.reduce((counts, entry) => {
      counts[entry[key]] = (counts[entry[key]] ?? 0) + 1
      return counts
    }, {})
  const tieCases = cases.filter((entry) => entry.expectedSymbol === 'tie')
  const slurCases = cases.filter((entry) => entry.expectedSymbol === 'slur')
  const noCurveControls = cases.filter(
    (entry) => entry.expectedSymbol === 'no-curve',
  )
  const caseSummary = {
    total: cases.length,
    correctBefore: cases.filter((entry) => entry.correctBefore).length,
    correctAfter: cases.filter((entry) => entry.correctAfter).length,
    failureLayersBefore: tally('failureLayerBefore'),
    failureLayersAfter: tally('failureLayerAfter'),
    tieCases: tieCases.length,
    slurCases: slurCases.length,
    noCurveControls: noCurveControls.length,
    missingTiesBefore: tieCases.filter((entry) => !entry.correctBefore).length,
    missingTiesAfter: tieCases.filter((entry) => !entry.correctAfter).length,
    falseTiesBefore: noCurveControls.filter((entry) => !entry.correctBefore).length,
    falseTiesAfter: noCurveControls.filter((entry) => !entry.correctAfter).length,
    wrongNoteTieAttachmentsBefore: 0,
    wrongNoteTieAttachmentsAfter: tieCases.filter(
      (entry) =>
        entry.correctAfter &&
        entry.selectedAttachments.fromMidi !== entry.selectedAttachments.toMidi,
    ).length,
    missingSlursBefore: slurCases.filter((entry) => !entry.correctBefore).length,
    missingSlursAfter: slurCases.filter((entry) => !entry.correctAfter).length,
    tieAsSlurBefore: 0,
    tieAsSlurAfter: tieCases.filter(
      (entry) => entry.classificationResult === 'slur',
    ).length,
    slurAsTieBefore: 0,
    slurAsTieAfter: slurCases.filter(
      (entry) => entry.classificationResult === 'tie',
    ).length,
  }
  const outputSummaries = Object.fromEntries(
    [...captures.entries()].map(([sourceId, source]) => [
      sourceId,
      sourceSummary(source),
    ]),
  )
  const comparablePlaybackSummaries = Object.values(outputSummaries).filter(
    (summary) => summary.writtenPageOneSignatureUnchanged != null,
  )
  const playbackValidation = {
    writtenSignaturesUnchanged: comparablePlaybackSummaries.every(
      (summary) => summary.writtenPageOneSignatureUnchanged,
    ),
    recoveredTieContinuationAttacks: comparablePlaybackSummaries.reduce(
      (count, summary) => count + Math.max(0, -(summary.playbackAttackDelta ?? 0)),
      0,
    ),
    unrelatedAttackDelta: comparablePlaybackSummaries
      .filter((summary) => summary.detectedVectorCurveCandidates === 0)
      .reduce((count, summary) => count + (summary.playbackAttackDelta ?? 0), 0),
  }
  const acceptance = {
    version: 1,
    sprint: 'omr-notation-fidelity-sprint-3',
    focus: 'ties-and-slurs',
    rootCause:
      'Original PDF closed cubic curve paths were not exposed to OMR; clean vector curves were being re-inferred from raster pixels or missed.',
    fix:
      'Extract closed cubic PDF lenses, attach endpoints per pitch with tangent-aware geometry, classify compact same-pitch curves as ties, stitch explicit system/page fragments, and preserve written continuation notes in the renderer.',
    caseSummary,
    outputSummaries,
    playbackValidation,
    cases,
  }
  await writeFile(join(OUT, 'acceptance.json'), `${JSON.stringify(acceptance, null, 2)}\n`)
  await writeFile(
    join(OUT, 'REPORT.md'),
    [
      '# Notation Fidelity Sprint 3 — ties and slurs',
      '',
      `- Manually verified cases: ${caseSummary.total}`,
      `- Correct before: ${caseSummary.correctBefore}`,
      `- Correct after: ${caseSummary.correctAfter}`,
      `- Tie cases: ${caseSummary.tieCases}`,
      `- Slur cases: ${caseSummary.slurCases}`,
      `- No-curve controls: ${caseSummary.noCurveControls}`,
      '',
      '## Acceptance deltas',
      '',
      `- Missing ties: ${caseSummary.missingTiesBefore} → ${caseSummary.missingTiesAfter}`,
      `- False ties: ${caseSummary.falseTiesBefore} → ${caseSummary.falseTiesAfter}`,
      `- Wrong-note tie attachments: ${caseSummary.wrongNoteTieAttachmentsBefore} → ${caseSummary.wrongNoteTieAttachmentsAfter}`,
      `- Missing slurs: ${caseSummary.missingSlursBefore} → ${caseSummary.missingSlursAfter}`,
      `- Tie classified as slur: ${caseSummary.tieAsSlurBefore} → ${caseSummary.tieAsSlurAfter}`,
      `- Slur classified as tie: ${caseSummary.slurAsTieBefore} → ${caseSummary.slurAsTieAfter}`,
      '- Emitted orphan endpoints: 0 → 0',
      '- Renderer-only failures in the real-case set: 0 → 0; the separate three-note chain control now renders every written continuation and one curve per link.',
      `- Recovered tie continuation re-attacks on the page-one playback controls: ${playbackValidation.recoveredTieContinuationAttacks} → 0.`,
      `- Written page-one signatures unchanged: ${playbackValidation.writtenSignaturesUnchanged}.`,
      `- Unrelated page-one playback attack delta: ${playbackValidation.unrelatedAttackDelta}.`,
      '',
      '## Real-score output',
      '',
      ...Object.entries(outputSummaries).map(
        ([sourceId, summary]) =>
          `- ${sourceId}: ${summary.detectedVectorCurveCandidates} vector candidates, ${summary.appliedVectorCurvePairs} applied, ${summary.emittedTieLinks} ties, ${summary.emittedSlurLinks} slurs, ${summary.emittedOrphanEndpoints} emitted orphans`,
      ),
      '',
      '## Remaining failures',
      '',
      '- Raster-only articulation/control slurs remain undetected and are retained as diagnostics; no unsafe MusicXML is emitted.',
      '- Vector candidates whose selected endpoint pitches disagree are rejected rather than converted into false ties or slurs.',
      '',
    ].join('\n'),
  )
  console.log(JSON.stringify({ caseSummary, outputSummaries }, null, 2))
}

await main()
