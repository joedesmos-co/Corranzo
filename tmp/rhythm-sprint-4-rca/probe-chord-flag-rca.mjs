/**
 * Rhythm Sprint 4 — dense chord sequentialization + flag/partial-beam RCA.
 * Analysis only; does not change recognition code.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { processOmrPageAnalysis } from '../../src/features/omr/processOmrPage.js'
import { getInstrument } from '../../src/features/instruments/instruments.js'
import { evaluateSemanticMusicXml } from '../../src/features/omr/semanticMusicXmlEvaluator.js'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import { summarizeVectorChordGrouping } from '../../src/features/omr/omrChordGroupingDiagnostics.js'
import {
  detectStem,
  measureBeamStrength,
  hasSecondaryBeamRow,
  countBeams,
} from '../../src/features/omr/detectNoteRhythmFeatures.js'
import { isInk } from '../../src/features/omr/omrInk.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'tmp/rhythm-sprint-4-rca')
mkdirSync(OUT, { recursive: true })

const TARGETS = [
  { id: 'piano-dense-advanced-vector', instrumentId: 'piano', sampleMeasures: [2, 3, 4] },
  { id: 'guitar-standard-chords-vector', instrumentId: 'guitar', sampleMeasures: [1, 2] },
  { id: 'piano-rhythm-tuplets-vector', instrumentId: 'piano', sampleMeasures: [2, 7] },
  { id: 'guitar-paired-chords-vector', instrumentId: 'guitar', sampleMeasures: [1] },
]

function avg(xs) {
  const vals = xs.filter(Number.isFinite)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
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

function sequentialSameXPairs(events, maxDx = 14) {
  const notes = events.filter((e) => e.type === 'note')
  const pairs = []
  for (let i = 0; i < notes.length; i += 1) {
    for (let j = i + 1; j < notes.length; j += 1) {
      const a = notes[i]
      const b = notes[j]
      if ((a.startDivision ?? 0) === (b.startDivision ?? 0)) continue
      const aClef = a.notes?.[0]?.clef ?? 'treble'
      const bClef = b.notes?.[0]?.clef ?? 'treble'
      if (aClef !== bClef) continue
      const acx = avg((a.notes || []).map((n) => n.cx))
      const bcx = avg((b.notes || []).map((n) => n.cx))
      if (!Number.isFinite(acx) || !Number.isFinite(bcx)) continue
      const dx = Math.abs(acx - bcx)
      if (dx > maxDx) continue
      const startGap = Math.abs((a.startDivision ?? 0) - (b.startDivision ?? 0))
      pairs.push({
        starts: [a.startDivision, b.startDivision],
        startGap,
        durs: [a.durationDivisions, b.durationDivisions],
        dx: Math.round(dx * 10) / 10,
        midis: [(a.notes || []).map((n) => n.midi), (b.notes || []).map((n) => n.midi)],
        noteCounts: [a.notes?.length || 0, b.notes?.length || 0],
        beams: [(a.notes || []).map((n) => n.beams), (b.notes || []).map((n) => n.beams)],
        positions: [
          avg((a.notes || []).map((n) => n.positionInMeasure)),
          avg((b.notes || []).map((n) => n.positionInMeasure)),
        ],
        cursorAdvanceSuspect: startGap > 0 && startGap <= 3 && dx <= 10,
      })
    }
  }
  return pairs.sort((a, b) => a.dx - b.dx || a.startGap - b.startGap)
}

function probeFlagEvidence(imageData, stem, threshold) {
  if (!stem) return { flagLike: false }
  const primary = measureBeamStrength(imageData, stem, threshold)
  const secondary = hasSecondaryBeamRow(imageData, stem, threshold)
  const beams = countBeams(imageData, stem, threshold, null)
  if (primary >= 8) {
    return {
      flagLike: false,
      reason: 'has-primary-beam',
      primary,
      secondary,
      beams,
      partialSecondary: secondary,
    }
  }
  const towardHead = stem.direction === 'up' ? 1 : -1
  const shortRuns = []
  for (const dy of [0, 1, 2, 3, -1]) {
    const y = stem.tipY + dy
    for (const dir of [1, -1]) {
      let run = 0
      for (let x = stem.x + dir; Math.abs(x - stem.x) <= 14; x += dir) {
        const px = Math.round(x)
        const py = Math.round(y)
        if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) break
        if (isInk(imageData.data, (py * imageData.width + px) * 4, threshold)) run += 1
        else if (run > 0) break
      }
      if (run >= 3 && run <= 12) shortRuns.push({ y, dir, run })
    }
  }
  let secondaryShort = 0
  for (const offset of [3, 4, 5, 6]) {
    const y = stem.tipY + towardHead * offset
    let run = 0
    for (let x = stem.x; x <= stem.x + 12; x += 1) {
      const px = Math.round(x)
      const py = Math.round(y)
      if (px < 0 || py < 0 || px >= imageData.width || py >= imageData.height) break
      if (isInk(imageData.data, (py * imageData.width + px) * 4, threshold)) run += 1
      else if (run > 0) break
    }
    if (run >= 3 && run <= 10) secondaryShort += 1
  }
  return {
    flagLike: shortRuns.length >= 1,
    doubleFlagLike: shortRuns.filter((r) => r.run >= 4).length >= 2 || secondaryShort >= 2,
    primary,
    shortRuns: shortRuns.slice(0, 6),
    secondaryShort,
    beams,
    secondary: false,
  }
}

function summarizeEvent(e) {
  return {
    type: e.type,
    start: e.startDivision,
    dur: e.durationDivisions,
    dtype: e.durationType,
    clef: e.notes?.[0]?.clef ?? e.clef,
    midis: (e.notes || []).map((n) => n.midi),
    noteCount: e.notes?.length || 0,
    cx: Math.round(avg((e.notes || []).map((n) => n.cx)) ?? e.cx ?? 0),
    pos: Math.round((avg((e.notes || []).map((n) => n.positionInMeasure)) || 0) * 1000) / 1000,
    beams: (e.notes || []).map((n) => n.beams),
    bStr: (e.notes || []).map((n) => n.beamStrength),
    noteDur: (e.notes || []).map((n) => n.durationType),
    stemX: (e.notes || []).map((n) => n.stem?.x),
  }
}

async function runFixture(target) {
  const { id, instrumentId, sampleMeasures } = target
  const pdfPath = join(ROOT, `benchmarks/omr-fixtures/${id}/${id}.pdf`)
  const truthPath = join(ROOT, `benchmarks/omr-fixtures/${id}/${id}.musicxml`)
  if (!existsSync(pdfPath) || !existsSync(truthPath)) {
    return { id, error: 'missing fixture files' }
  }

  console.log(`\n==== ${id} ====`)
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT, maxPages: 2 })
  const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
  const instrument = getInstrument(instrumentId)

  const pipeline = await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages: Math.min(2, rendered.numPages),
    preprocessPages: true,
    instrumentId,
    title: id,
  })
  const generatedMusicXml = pipeline.musicXml
  writeFileSync(join(OUT, `${id}.omr.musicxml`), generatedMusicXml)
  const truthXml = readFileSync(truthPath, 'utf8')
  const evalReport = evaluateSemanticMusicXml({
    groundTruthMusicXml: truthXml,
    generatedMusicXml,
    groundTruthFileName: `${id}.musicxml`,
    generatedFileName: `${id}.omr.musicxml`,
    options: { mode: 'written' },
  })

  const pageText = await extractPageText(null, 1)
  const page = rendered.pages[0]
  const imageData = { width: page.width, height: page.height, data: page.data }
  const analysis = processOmrPageAnalysis(imageData, {
    page: 1,
    pageText: pageText.items || pageText,
    instrument,
    dense: id.includes('dense'),
  })
  const byNumber = new Map(collectMeasureRecords(analysis).map((m) => [m.measureNumber, m]))

  const samples = []
  for (const mn of sampleMeasures) {
    const rec = byNumber.get(mn)
    const measureEval = (evalReport.measures || []).find((m) => m.measureNumber === mn)
    if (!rec) {
      samples.push({ measureNumber: mn, missingRecord: true })
      continue
    }
    const events = rec.events || []
    const noteEvents = events.filter((e) => e.type === 'note')
    const chordSum = summarizeVectorChordGrouping(events)
    const seqPairs = sequentialSameXPairs(events)
    const cursorSuspects = seqPairs.filter((p) => p.cursorAdvanceSuspect)

    const flagProbe = []
    const secondaryHits = []
    const stemShareCandidates = []

    // Stem-share heuristic: notes with nearly identical stem.x but different starts
    for (let i = 0; i < noteEvents.length; i += 1) {
      for (let j = i + 1; j < noteEvents.length; j += 1) {
        const a = noteEvents[i]
        const b = noteEvents[j]
        if ((a.startDivision ?? 0) === (b.startDivision ?? 0)) continue
        const aClef = a.notes?.[0]?.clef
        const bClef = b.notes?.[0]?.clef
        if (aClef !== bClef) continue
        for (const na of a.notes || []) {
          for (const nb of b.notes || []) {
            const sxA = na.stem?.x
            const sxB = nb.stem?.x
            if (!Number.isFinite(sxA) || !Number.isFinite(sxB)) continue
            if (Math.abs(sxA - sxB) <= 2 && Math.abs((na.cx ?? 0) - (nb.cx ?? 0)) <= 12) {
              stemShareCandidates.push({
                starts: [a.startDivision, b.startDivision],
                stemX: [sxA, sxB],
                cx: [na.cx, nb.cx],
                midis: [na.midi, nb.midi],
              })
            }
          }
        }
      }
    }

    for (const ev of noteEvents) {
      for (const n of ev.notes || []) {
        const stem =
          n.stem ||
          (Number.isFinite(n.cx) && Number.isFinite(n.cy)
            ? detectStem(imageData, n.cx, n.cy, 200, n.cy)
            : null)
        if (!stem) continue
        const probe = probeFlagEvidence(imageData, stem, 200)
        if (probe.secondary || (n.beams ?? 0) >= 2) {
          secondaryHits.push({
            start: ev.startDivision,
            midi: n.midi,
            beams: n.beams,
            noteDur: n.durationType,
            eventDur: ev.durationType,
            eventDurDiv: ev.durationDivisions,
            primary: probe.primary,
          })
        }
        if (probe.flagLike || probe.doubleFlagLike) {
          flagProbe.push({
            start: ev.startDivision,
            midi: n.midi,
            noteDur: n.durationType,
            eventDur: ev.durationType,
            eventDurDiv: ev.durationDivisions,
            beams: n.beams,
            bStr: n.beamStrength,
            doubleFlagLike: probe.doubleFlagLike,
            primary: probe.primary,
            shortRuns: probe.shortRuns,
            secondaryShort: probe.secondaryShort,
          })
        }
      }
    }

    const durHist = {}
    const beamHist = { 0: 0, 1: 0, 2: 0 }
    for (const e of noteEvents) {
      const k = `${e.durationType || '?'}:d${e.durationDivisions}`
      durHist[k] = (durHist[k] || 0) + 1
      for (const n of e.notes || []) {
        const b = Math.min(2, n.beams ?? 0)
        beamHist[b] = (beamHist[b] || 0) + 1
      }
    }

    const defects = measureEval?.defects || []
    const defectCodes = {}
    for (const d of defects) defectCodes[d.code] = (defectCodes[d.code] || 0) + 1

    samples.push({
      measureNumber: mn,
      alignment: measureEval?.alignment,
      eventCount: noteEvents.length,
      starts: [...new Set(noteEvents.map((e) => e.startDivision))].sort((a, b) => a - b),
      multiNoteEvents: noteEvents.filter((e) => (e.notes?.length || 0) > 1).length,
      singleNoteEvents: noteEvents.filter((e) => (e.notes?.length || 0) === 1).length,
      chordSummary: {
        onsetCount: chordSum.onsetCount,
        sequentialSameXCount: chordSum.sequentialSameXCount,
        fragmentedSameClefOnsets: (chordSum.onsets || []).filter((o) => o.fragmentedSameClef).length,
      },
      sequentialPairCount: seqPairs.length,
      cursorAdvanceSuspectCount: cursorSuspects.length,
      sequentialSameXPairs: seqPairs.slice(0, 12),
      stemShareCandidateCount: stemShareCandidates.length,
      stemShareCandidates: stemShareCandidates.slice(0, 10),
      durHist,
      beamHist,
      flagProbeCount: flagProbe.length,
      flagProbe: flagProbe.slice(0, 12),
      secondaryHitCount: secondaryHits.length,
      secondaryHits: secondaryHits.slice(0, 10),
      defectCodes,
      events: noteEvents.slice(0, 16).map(summarizeEvent),
    })
  }

  return {
    id,
    rhythm: evalReport.classes?.rhythm?.percent ?? evalReport.scorePercents?.rhythm,
    overall: evalReport.overallPercent,
    topDefects: evalReport.topDefects?.slice(0, 8) || [],
    samples,
  }
}

const report = { createdAt: new Date().toISOString(), fixtures: [] }
for (const target of TARGETS) {
  try {
    const result = await runFixture(target)
    report.fixtures.push(result)
    writeFileSync(join(OUT, `${target.id}.rca.json`), JSON.stringify(result, null, 2))
    console.log('R=', result.rhythm)
    for (const s of result.samples || []) {
      if (s.missingRecord) {
        console.log(`  m${s.measureNumber}: missing`)
        continue
      }
      console.log(
        `  m${s.measureNumber}: events=${s.eventCount} starts=[${s.starts}] multi=${s.multiNoteEvents} single=${s.singleNoteEvents} seqPairs=${s.sequentialPairCount} cursorSuspect=${s.cursorAdvanceSuspectCount} stemShare=${s.stemShareCandidateCount} flags=${s.flagProbeCount} secBeam=${s.secondaryHitCount} dur=${s.defectCodes['duration-mismatch'] || 0} onset=${s.defectCodes['onset-mismatch'] || 0}`,
      )
      if (s.sequentialSameXPairs[0]) {
        console.log('    seq0', JSON.stringify(s.sequentialSameXPairs[0]))
      }
      if (s.stemShareCandidates[0]) {
        console.log('    stem0', JSON.stringify(s.stemShareCandidates[0]))
      }
      if (s.flagProbe[0]) {
        console.log(
          '    flag0',
          JSON.stringify({
            midi: s.flagProbe[0].midi,
            noteDur: s.flagProbe[0].noteDur,
            eventDur: s.flagProbe[0].eventDur,
            double: s.flagProbe[0].doubleFlagLike,
            primary: s.flagProbe[0].primary,
          }),
        )
      }
    }
  } catch (error) {
    console.error('FAIL', target.id, error)
    report.fixtures.push({ id: target.id, error: String(error?.stack || error) })
  }
}

writeFileSync(join(OUT, 'probe-summary.json'), JSON.stringify(report, null, 2))
console.log('\nWrote', join(OUT, 'probe-summary.json'))
