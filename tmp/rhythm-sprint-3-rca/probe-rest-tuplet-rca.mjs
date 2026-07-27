#!/usr/bin/env node
/**
 * Rhythm Sprint 3 — rests + tuplets RCA probe (analysis only).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { processOmrPageAnalysis } from '../../src/features/omr/processOmrPage.js'
import { getInstrument } from '../../src/features/instruments/instruments.js'
import { evaluateSemanticMusicXml } from '../../src/features/omr/semanticMusicXmlEvaluator.js'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import { serializeOmrV3MusicXml } from '../../src/features/omr/v3/omrV3MusicXml.js'
import { restsForMeasure } from '../../src/features/omr/detectVectorRests.js'
import { textGlyphsToImage } from '../../src/features/omr/processVectorOmrPage.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'tmp/rhythm-sprint-3-rca')
mkdirSync(OUT, { recursive: true })

const FIXTURES = [
  {
    id: 'piano-articulation-scan',
    instrumentId: 'piano',
    sampleMeasures: [2, 3, 4, 7],
  },
  {
    id: 'piano-rhythm-tuplets-vector',
    instrumentId: 'piano',
    sampleMeasures: [3, 4, 5, 6],
  },
  {
    id: 'piano-beginner-single-vector',
    instrumentId: 'piano',
    sampleMeasures: [7],
  },
]

const VECTOR_REST_GLYPHS = new Set(['\ue4e3', '\ue4e4', '\ue4e5', '\ue4e6', '\ue4e7'])
// SMuFL tuplet digits / triplet number often U+E880–E88A range; also plain "3"
const TUPLET_HINT_RE = /^[3456789]$|^\ue88[0-9a]$/i

function summarizeEvent(e) {
  return {
    type: e.type,
    start: e.startDivision,
    dur: e.durationDivisions,
    dtype: e.durationType,
    dotted: Boolean(e.dotted),
    clef: e.notes?.[0]?.clef ?? e.clef,
    voice: e.voice,
    source: e.source ?? null,
    uncertain: Boolean(e.uncertain),
    confidence: e.confidence,
    pos: e.positionInMeasure,
    cx: e.cx,
    pitches: (e.notes || []).map((n) => `${n.step ?? ''}${n.octave ?? ''}`),
    midi: (e.notes || []).map((n) => n.midi),
    beams: (e.notes || []).map((n) => n.beams),
    noteDur: (e.notes || []).map((n) => n.durationType),
  }
}

function collectMeasureRecords(result) {
  const out = []
  const seen = new Set()
  const walk = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 14) return
    if (Array.isArray(obj)) {
      for (const e of obj) walk(e, depth + 1)
      return
    }
    if (obj.measureNumber != null && (obj.events || obj.notes) && !seen.has(obj)) {
      seen.add(obj)
      out.push(obj)
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') walk(v, depth + 1)
    }
  }
  walk(result)
  return out
}

function classifyRestEvent(event, context) {
  const { truthHasRestAtOnset, detectedGlyphNearby, validationUncertain, path } = context
  if (event.source === 'vector-glyph') {
    if (!truthHasRestAtOnset) return 'false-positive-rest-glyph'
    return 'true-positive-vector-rest'
  }
  if (event.uncertain === true || event.confidence === 0.5) {
    return 'rest-insertion-from-measure-balancing'
  }
  if (path === 'raster' && event.durationType === 'quarter' && event.durationDivisions === 4) {
    return detectedGlyphNearby ? 'raster-rest-blob' : 'false-positive-rest-blob'
  }
  if (!truthHasRestAtOnset) return 'false-positive-rest'
  return 'matched-or-ambiguous-rest'
}

function parseMusicXmlMeasureNotes(xml, measureNumber) {
  const body = xml.match(
    new RegExp(`<measure[^>]*number="${measureNumber}"[\\s\\S]*?</measure>`),
  )?.[0]
  if (!body) return []
  let cursor = 0
  const voices = new Map()
  const notes = []
  for (const match of body.matchAll(/<note[\s\S]*?<\/note>|<forward>[\s\S]*?<\/forward>|<backup>[\s\S]*?<\/backup>/g)) {
    const chunk = match[0]
    if (chunk.startsWith('<forward>')) {
      cursor += Number(chunk.match(/<duration>(\d+)/)?.[1] ?? 0)
      continue
    }
    if (chunk.startsWith('<backup>')) {
      cursor -= Number(chunk.match(/<duration>(\d+)/)?.[1] ?? 0)
      continue
    }
    const voice = Number(chunk.match(/<voice>(\d+)/)?.[1] ?? 1)
    const isChord = /<chord\s*\/>|<chord>/.test(chunk)
    if (!voices.has(voice)) voices.set(voice, 0)
    if (!isChord) {
      // voice-local cursor approximated from sequential notes; reset via backup/forward above
    }
    const dur = Number(chunk.match(/<duration>(\d+)/)?.[1] ?? 0)
    const rest = /<rest/.test(chunk)
    const type = chunk.match(/<type[^>]*>([^<]+)/)?.[1] ?? null
    const staff = Number(chunk.match(/<staff>(\d+)/)?.[1] ?? 1)
    const step = chunk.match(/<step>([^<]+)/)?.[1]
    const oct = chunk.match(/<octave>(\d+)/)?.[1]
    const tm = chunk.match(/<actual-notes>(\d+)[\s\S]*?<normal-notes>(\d+)/)
    const onset = isChord ? notes.filter((n) => n.voice === voice).at(-1)?.onset ?? cursor : cursor
    notes.push({
      rest,
      chord: isChord,
      type,
      dur,
      voice,
      staff,
      pitch: step ? `${step}${oct}` : null,
      tuplet: tm ? `${tm[1]}:${tm[2]}` : null,
      onset,
    })
    if (!isChord) cursor += dur
  }
  return notes
}

function measureTraceV3(document, measureNumber) {
  const measures = (document?.pages ?? []).flatMap((page) =>
    (page.systems ?? []).flatMap((system) => system.measureColumns ?? []),
  )
  const measure = measures.find((entry) => entry.measureNumber === measureNumber)
  if (!measure) return null
  const voices = (measure.voices ?? []).filter((voice) => voice.candidateRank === 0)
  return {
    measureNumber,
    beats: measure.beats,
    totalDivisions: measure.totalDivisions,
    onsetColumnCount: measure.onsetColumns?.length ?? 0,
    onsetColumns: (measure.onsetColumns ?? []).map((column) => ({
      id: column.onsetColumnId,
      position: column.measureRelativePosition,
    })),
    voices: voices.map((voice) => ({
      voiceId: voice.voiceId,
      laneIndex: voice.laneIndex,
      staffId: voice.staffId,
      events: (voice.events ?? []).map((event) => ({
        kind: event.kind ?? (event.writtenPitch || event.pitch ? 'note' : 'rest'),
        pitch: event.writtenPitch ?? event.pitch ?? null,
        onset: event.onset?.divisions ?? event.onset,
        duration: event.duration?.divisions ?? event.duration,
        durationType: event.duration?.type ?? null,
        onsetRecovery: event.onset?.recovery ?? null,
        durationRecovery: event.duration?.recovery ?? null,
        tuplet: event.technical?.tuplet ?? null,
      })),
    })),
  }
}

async function probeFixture(fixture) {
  const pdfPath = join(
    ROOT,
    `benchmarks/omr-fixtures/${fixture.id}/${fixture.id}.pdf`,
  )
  const truthPath = join(
    ROOT,
    `benchmarks/omr-fixtures/${fixture.id}/${fixture.id}.musicxml`,
  )
  const truth = readFileSync(truthPath, 'utf8')
  const instrument = getInstrument(fixture.instrumentId)
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT, maxPages: 1 })
  const extractPageText = await makePdfTextExtractor(pdfPath)

  const rawPageText = await extractPageText(pdfPath, 1)
  const pageTextItems = rawPageText.items || rawPageText
  const page = rendered.pages[0]
  const imagePayload = { width: page.width, height: page.height, data: page.data }
  const glyphs = textGlyphsToImage(pageTextItems, imagePayload)
  const restGlyphs = (glyphs ?? []).filter((g) => VECTOR_REST_GLYPHS.has(g.text))
  const tupletHintGlyphs = (pageTextItems ?? [])
    .filter((item) => TUPLET_HINT_RE.test(String(item.text ?? '').trim()))
    .map((item) => ({
      text: item.text,
      x: item.x,
      y: item.y,
      fontName: item.fontName,
    }))
  const digitGlyphs = (pageTextItems ?? [])
    .filter((item) => /^[0-9]$/.test(String(item.text ?? '').trim()))
    .map((item) => ({ text: item.text, x: item.x, y: item.y, fontName: item.fontName }))

  const pageAnalysis = processOmrPageAnalysis(imagePayload, {
    page: 1,
    pageText: pageTextItems,
    instrument,
    captureOmrV3RawSymbols: true,
  })

  const pipeline = await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages: Math.min(1, rendered.numPages),
    preprocessPages: true,
    includeScoreGraph: false,
    omrV3Shadow: true,
    instrumentId: fixture.instrumentId,
    title: fixture.id,
  })

  const evalResult = evaluateSemanticMusicXml({
    groundTruthMusicXml: truth,
    generatedMusicXml: pipeline.musicXml,
    groundTruthFileName: `${fixture.id}.musicxml`,
    generatedFileName: `${fixture.id}.omr.musicxml`,
    options: { mode: 'written' },
  })

  const records = collectMeasureRecords(pageAnalysis)
  const pathSource =
    pageAnalysis?.diagnostics?.source ??
    pageAnalysis?.source ??
    (restGlyphs.length > 0 || (glyphs?.length ?? 0) > 20 ? 'likely-vector' : 'likely-raster')

  const measureSamples = []
  for (const measureNumber of fixture.sampleMeasures) {
    const record =
      records.find((r) => r.measureNumber === measureNumber) ??
      records.find((r) => Number(r.measureNumber) === measureNumber)
    const events = (record?.events ?? []).map(summarizeEvent)
    const rests = events.filter((e) => e.type === 'rest')
    const detectorRests = record?.detectorObservations?.rests ?? []
    const vectorRestDiag = record?.vectorRestDiagnostics ?? null
    const validation = record?.validation ?? null

    const truthNotes = parseMusicXmlMeasureNotes(truth, measureNumber)
    const genNotes = parseMusicXmlMeasureNotes(pipeline.musicXml, measureNumber)
    const truthRests = truthNotes.filter((n) => n.rest)
    const genRests = genNotes.filter((n) => n.rest)
    const truthTuplets = truthNotes.filter((n) => n.tuplet)
    const genTuplets = genNotes.filter((n) => n.tuplet)

    const restClassifications = rests.map((rest) => {
      const truthHasRestAtOnset = truthRests.some(
        (t) => Math.abs((t.onset ?? 0) - (rest.start ?? 0)) <= 2,
      )
      return {
        ...rest,
        class: classifyRestEvent(rest, {
          truthHasRestAtOnset,
          detectedGlyphNearby: detectorRests.some(
            (d) => Math.abs((d.cx ?? 0) - (rest.cx ?? 0)) <= 12,
          ),
          validationUncertain: Boolean(validation?.uncertain),
          path: pathSource,
        }),
      }
    })

    // Also classify MusicXML rests (may differ if post-processed)
    const xmlRestClasses = genRests.map((rest) => {
      const truthHit = truthRests.some(
        (t) => Math.abs((t.onset ?? 0) - (rest.onset ?? 0)) <= 2 && t.type === rest.type,
      )
      const balancingLike =
        (rest.type === 'quarter' && rest.dur === 1) ||
        (rest.type === 'eighth' && rest.dur === 2) ||
        (rest.type === 'quarter' && rest.dur === 1)
      let cls = 'unknown'
      if (!truthRests.length && genRests.length) {
        cls = balancingLike
          ? 'rest-insertion-from-measure-balancing'
          : 'false-positive-rest'
      } else if (truthRests.length && !truthHit) {
        cls = balancingLike
          ? 'rest-insertion-from-measure-balancing'
          : 'wrong-duration-or-onset'
      } else if (truthHit) {
        cls = 'matched-rest'
      } else if (!genRests.length && truthRests.length) {
        cls = 'missed-rest'
      }
      return { ...rest, class: cls }
    })

    const missingRestClasses =
      truthRests.length && !genRests.length
        ? truthRests.map((t) => ({ ...t, class: 'missed-rest' }))
        : truthRests
            .filter(
              (t) =>
                !genRests.some(
                  (g) => Math.abs((g.onset ?? 0) - (t.onset ?? 0)) <= 3,
                ),
            )
            .map((t) => ({ ...t, class: 'missed-rest' }))

    const v3Trace = measureTraceV3(
      pipeline.omrV3IndependentShadow?.document,
      measureNumber,
    )
    const v3Tuplets = (v3Trace?.voices ?? []).flatMap((v) =>
      (v.events ?? []).filter((e) => e.tuplet),
    )

    // Local vector rest detection against this measure box if present
    let localVectorRests = null
    if (record && glyphs?.length) {
      const box = {
        measureNumber,
        x0: record.x0,
        x1: record.x1,
        y0: record.y0,
        y1: record.y1,
        playableX0: record.playableX0,
        staffLines: record.staffLines,
        page: 1,
      }
      if (Number.isFinite(box.x0) && Number.isFinite(box.x1)) {
        localVectorRests = restsForMeasure(
          glyphs,
          imagePayload,
          box,
          record.detectorObservations?.noteheads ?? [],
        )
      }
    }

    measureSamples.push({
      measureNumber,
      pathHint: pathSource,
      eventCount: events.length,
      restEventCount: rests.length,
      events,
      rests: restClassifications,
      detectorRests,
      vectorRestDiagnostics: vectorRestDiag,
      validation,
      localVectorRests,
      truthNotes,
      genNotes,
      truthRests,
      genRests,
      xmlRestClasses,
      missingRestClasses,
      truthTuplets: truthTuplets.map((n) => ({
        pitch: n.pitch,
        type: n.type,
        dur: n.dur,
        onset: n.onset,
        tuplet: n.tuplet,
      })),
      genTuplets,
      v3Trace,
      v3TupletEventCount: v3Tuplets.length,
      v3TupletSample: v3Tuplets.slice(0, 6),
    })
  }

  const shadow = pipeline.omrV3IndependentShadow
  const v3Xml = shadow?.document
    ? serializeOmrV3MusicXml(shadow.document)?.musicXml
    : null
  const v3HasTimeMod = Boolean(v3Xml && /time-modification/.test(v3Xml))
  const v2HasTimeMod = /time-modification/.test(pipeline.musicXml)

  const defectRollup = {}
  for (const d of evalResult.topDefects ?? []) {
    if (/rest|tuplet|onset|duration/i.test(d.code)) defectRollup[d.code] = d.count
  }

  // Aggregate rest classes across samples
  const restTaxonomy = {}
  for (const sample of measureSamples) {
    for (const r of [...sample.xmlRestClasses, ...sample.missingRestClasses]) {
      restTaxonomy[r.class] = (restTaxonomy[r.class] ?? 0) + 1
    }
  }

  const musicXmlPath = join(OUT, `${fixture.id}.omr.musicxml`)
  writeFileSync(musicXmlPath, pipeline.musicXml)
  if (v3Xml) writeFileSync(join(OUT, `${fixture.id}.v3.musicxml`), v3Xml)

  return {
    id: fixture.id,
    pathHint: pathSource,
    glyphStats: {
      totalTextItems: pageTextItems?.length ?? 0,
      restGlyphCount: restGlyphs.length,
      restGlyphs: restGlyphs.slice(0, 20).map((g) => ({
        text: [...g.text].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase()),
        x: g.x,
        y: g.y,
      })),
      digitGlyphCount: digitGlyphs.length,
      digitGlyphs: digitGlyphs.slice(0, 30),
      tupletHintCount: tupletHintGlyphs.length,
      tupletHintGlyphs,
    },
    totals: evalResult.totals,
    rhythm: evalResult.classes?.rhythm,
    defectRollup,
    restTaxonomy,
    v2HasTimeModification: v2HasTimeMod,
    v3IndependentHasTimeModification: v3HasTimeMod,
    v3ShadowStatus: shadow?.status ?? null,
    measureSamples,
    musicXmlPath,
  }
}

const reports = []
for (const fixture of FIXTURES) {
  console.error('probing', fixture.id)
  const report = await probeFixture(fixture)
  reports.push(report)
  writeFileSync(join(OUT, `${fixture.id}.rca.json`), JSON.stringify(report, null, 2))
  console.error(
    '  rests taxonomy',
    report.restTaxonomy,
    'v2 tuplet',
    report.v2HasTimeModification,
    'v3 tuplet xml',
    report.v3IndependentHasTimeModification,
  )
}

writeFileSync(
  join(OUT, 'probe-summary.json'),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      fixtures: reports.map((r) => ({
        id: r.id,
        pathHint: r.pathHint,
        glyphStats: r.glyphStats,
        totals: r.totals,
        rhythm: r.rhythm,
        defectRollup: r.defectRollup,
        restTaxonomy: r.restTaxonomy,
        v2HasTimeModification: r.v2HasTimeModification,
        v3IndependentHasTimeModification: r.v3IndependentHasTimeModification,
        v3ShadowStatus: r.v3ShadowStatus,
        sampleMeasureNumbers: r.measureSamples.map((m) => m.measureNumber),
      })),
    },
    null,
    2,
  ),
)

console.log(
  JSON.stringify(
    {
      ok: true,
      out: OUT,
      fixtures: reports.map((r) => r.id),
    },
    null,
    2,
  ),
)
