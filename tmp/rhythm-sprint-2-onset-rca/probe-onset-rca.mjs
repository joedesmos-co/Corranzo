/**
 * Rhythm Sprint 2 — onset RCA probe (analysis only).
 * Traces OMR events vs truth for high onset-mismatch fixtures and classifies causes.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { processOmrPageAnalysis } from '../../src/features/omr/processOmrPage.js'
import { getInstrument } from '../../src/features/instruments/instruments.js'
import { evaluateSemanticMusicXml } from '../../src/features/omr/semanticMusicXmlEvaluator.js'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
} from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'tmp/rhythm-sprint-2-onset-rca')
mkdirSync(OUT, { recursive: true })

const TARGETS = [
  { id: 'piano-dense-advanced-vector', instrumentId: 'piano', sampleMeasures: [2, 3, 4, 6] },
  { id: 'guitar-tab-sparse-vector', instrumentId: 'guitar', sampleMeasures: [2, 3, 6] },
  { id: 'piano-rhythm-tuplets-vector', instrumentId: 'piano', sampleMeasures: [2, 3, 7] },
  { id: 'piano-articulation-scan', instrumentId: 'piano', sampleMeasures: null },
  { id: 'guitar-standard-chords-vector', instrumentId: 'guitar', sampleMeasures: null },
]

const DIV = 4 // evaluator often uses quarter=4? check — OMR uses 4 per quarter typically as OMR_DIVISIONS_PER_QUARTER

function midiName(midi) {
  if (!Number.isFinite(midi)) return '?'
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const pc = ((midi % 12) + 12) % 12
  const oct = Math.floor(midi / 12) - 1
  return `${names[pc]}${oct}`
}

function summarizeEvent(e) {
  return {
    type: e.type,
    start: e.startDivision,
    dur: e.durationDivisions,
    dtype: e.durationType,
    dotted: Boolean(e.dotted),
    clef: e.notes?.[0]?.clef ?? e.clef,
    voice: e.voice,
    midi: (e.notes || []).map((n) => n.midi),
    pitches: (e.notes || []).map((n) => midiName(n.midi)),
    noteDur: (e.notes || []).map((n) => n.durationType),
    beams: (e.notes || []).map((n) => n.beams),
    bStr: (e.notes || []).map((n) => n.beamStrength),
    stem: (e.notes || []).map((n) => n.stem?.length),
    pos: e.positionInMeasure,
    cx: e.cx ?? average((e.notes || []).map((n) => n.cx)),
    adj: Object.fromEntries(
      Object.entries({
        beam: e.beamDurationAdjusted,
        clamp: e.durationClamped,
        clefExt: e.clefVoiceExtended || e.perClefExtended,
        penult: e.penultimateHalfAdjusted,
        beatQ: e.sameClefBeatQuarterAdjusted,
        termQ: e.terminalSameClefChordQuarterAdjusted,
        bassOpen: e.openingBassSubdivisionAdjusted,
        overhang: e.unsupportedUpperChordOverhangAdjusted,
        combined: e.combinedGrandStaffOpeningAdjusted,
      }).filter(([, v]) => v),
    ),
  }
}

function average(xs) {
  const vals = xs.filter(Number.isFinite)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

function collectMeasureRecords(result) {
  const out = []
  const seen = new Set()
  const walk = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 12) return
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

/**
 * Classify a single onset mismatch using paired truth/gen notes + measure events.
 */
function classifyOnsetDefect(defect, measureEvents, truthNotes, genNotes, measureDefects) {
  const msg = defect.message || ''
  const onsetMatch = msg.match(/off by\s+([\d.]+)/i)
  const deltaQ = onsetMatch ? Number(onsetMatch[1]) : null

  const hasDurationInMeasure = measureDefects.some((d) => d.code === 'duration-mismatch')
  const hasTuplet = measureDefects.some((d) => d.code === 'tuplet-mismatch')
  const hasExtraRest = measureDefects.some((d) => d.code === 'extra-rest')
  const hasMissingRest = measureDefects.some((d) => d.code === 'missing-rest')
  const hasSplit = measureDefects.some((d) => d.code === 'split-measure')
  const hasMissingVoice = measureDefects.some((d) => d.code === 'missing-voice')
  const hasIncorrectChord = measureDefects.some((d) => d.code === 'incorrect-chord')

  const events = (measureEvents || []).filter((e) => e.type === 'note')
  const rests = (measureEvents || []).filter((e) => e.type === 'rest')

  // Chord sequentialization: many gen onsets for notes that share truth onset
  const truthOnsetBuckets = new Map()
  for (const n of truthNotes || []) {
    const key = n.onsetDiv ?? n.startDivision ?? n.onset
    if (key == null) continue
    if (!truthOnsetBuckets.has(key)) truthOnsetBuckets.set(key, [])
    truthOnsetBuckets.get(key).push(n)
  }
  const multiNoteTruthChords = [...truthOnsetBuckets.values()].filter((g) => g.length >= 2).length
  const genStarts = new Set(events.map((e) => e.start))
  const sequentialized =
    multiNoteTruthChords > 0 &&
    events.length > (truthNotes?.length || 0) * 0.7 &&
    [...truthOnsetBuckets.values()].some((chord) => {
      if (chord.length < 2) return false
      // gen has more distinct starts than truth chords would imply near this region
      return genStarts.size > truthOnsetBuckets.size
    })

  // Voice: multiple clefs with interleaved starts that truth keeps separate
  const clefs = new Set(events.map((e) => e.clef).filter(Boolean))
  const voiceMix =
    hasMissingVoice ||
    (clefs.size >= 2 &&
      events.some((e, i) => {
        if (i === 0) return false
        const prev = events[i - 1]
        return prev.clef !== e.clef && e.start === prev.start
      }))

  // Duration cascade: prior event duration differs from gap, shifting later onsets
  let cascadeEvidence = 0
  for (let i = 0; i < events.length - 1; i += 1) {
    const gap = (events[i + 1].start ?? 0) - (events[i].start ?? 0)
    const dur = events[i].dur ?? 0
    // When duration was stretched/shrunk relative to positional gap origin
    if (Math.abs(gap - dur) <= 0.01 && hasDurationInMeasure) {
      cascadeEvidence += 1
    }
    // Notehead type disagrees with assigned duration
    const noteDurs = events[i].noteDur || []
    if (noteDurs.length && events[i].dtype && noteDurs.some((d) => d && d !== events[i].dtype)) {
      cascadeEvidence += 1
    }
  }

  // Beam grouping: beams present but duration not eighth, or beams=0 with eighth truth density
  const beamed = events.filter((e) => (e.beams || []).some((b) => b >= 1) || (e.bStr || []).some((s) => s >= 8))
  const beamIssue =
    beamed.length > 0 &&
    beamed.some((e) => e.dtype === 'quarter' || e.dtype === 'sixteenth' || (e.dur ?? 0) >= 4)

  // Tuplet
  if (hasTuplet || (deltaQ != null && Math.abs(deltaQ - 2 / 3) < 0.05)) {
    return { primary: 'E_tuplets', deltaQ, evidence: { hasTuplet, deltaQ } }
  }

  // Rests
  if (hasExtraRest || hasMissingRest || rests.length > 0) {
    // Only primary if rests likely shift timeline
    const restShift =
      rests.some((r) => (r.start ?? 0) > 0 && (r.start ?? 0) < 12) || hasExtraRest || hasMissingRest
    if (restShift && !hasDurationInMeasure) {
      return { primary: 'D_rests', deltaQ, evidence: { rests: rests.length, hasExtraRest, hasMissingRest } }
    }
  }

  // Measure packing
  if (hasSplit) {
    return { primary: 'G_measure_packing', deltaQ, evidence: { hasSplit } }
  }

  // Chord sequentialization
  if (sequentialized || (hasIncorrectChord && genStarts.size > truthOnsetBuckets.size + 1)) {
    return {
      primary: 'C_chord_sequentialized',
      deltaQ,
      evidence: { multiNoteTruthChords, genStarts: genStarts.size, truthOnsets: truthOnsetBuckets.size },
    }
  }

  // Voice separation
  if (voiceMix || hasMissingVoice) {
    return { primary: 'B_voice_separation', deltaQ, evidence: { clefs: [...clefs], hasMissingVoice } }
  }

  // Beam grouping
  if (beamIssue && deltaQ != null && (deltaQ === 0.25 || deltaQ === 0.5)) {
    return { primary: 'F_beam_grouping', deltaQ, evidence: { beamed: beamed.length } }
  }

  // Duration cascade (default when duration defects co-located)
  if (hasDurationInMeasure || cascadeEvidence >= 2) {
    return {
      primary: 'A_duration_cascade',
      deltaQ,
      evidence: { hasDurationInMeasure, cascadeEvidence, beamed: beamed.length },
    }
  }

  // Fallback by delta pattern
  if (deltaQ === 0.25 || deltaQ === 0.75) {
    return { primary: 'A_duration_cascade', deltaQ, evidence: { reason: 'sixteenth-grid-delta', cascadeEvidence } }
  }
  if (deltaQ === 0.5) {
    return { primary: 'A_duration_cascade', deltaQ, evidence: { reason: 'eighth-grid-delta', cascadeEvidence } }
  }

  return { primary: 'A_duration_cascade', deltaQ, evidence: { reason: 'default', cascadeEvidence } }
}

function extractPairedNotesFromMeasure(measure) {
  // Best-effort: look at pairs if present
  const pairs = measure.pairs || measure.matchedNotes || measure.notePairs || []
  return pairs
}

async function runFixture(target) {
  const { id, instrumentId } = target
  const pdfPath = join(ROOT, `benchmarks/omr-fixtures/${id}/${id}.pdf`)
  const truthPath = join(ROOT, `benchmarks/omr-fixtures/${id}/${id}.musicxml`)
  if (!existsSync(pdfPath) || !existsSync(truthPath)) {
    return { id, error: 'missing fixture files' }
  }

  console.log(`\n==== ${id} ====`)
  const rendered = await renderPdfToPages(pdfPath, { rootDir: ROOT, maxPages: 2 })
  const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
  const instrument = getInstrument(instrumentId)

  // Full pipeline for MusicXML + eval
  const pipeline = await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages: Math.min(2, rendered.numPages),
    preprocessPages: true,
    instrumentId,
    title: id,
  })
  const generatedMusicXml = pipeline.musicXml || pipeline.musicxml || pipeline.result?.musicXml
  const truthXml = readFileSync(truthPath, 'utf8')
  if (!generatedMusicXml) {
    throw new Error(`pipeline returned no musicXml; keys=${Object.keys(pipeline || {})}`)
  }
  const evalReport = evaluateSemanticMusicXml({
    groundTruthMusicXml: truthXml,
    generatedMusicXml,
    groundTruthFileName: `${id}.musicxml`,
    generatedFileName: `${id}.omr.musicxml`,
    options: { mode: 'written' },
  })

  // Page analysis for event-level traces (page 1)
  const pageText = await extractPageText(null, 1)
  const page = rendered.pages[0]
  const imageData = { width: page.width, height: page.height, data: page.data }
  const analysis = processOmrPageAnalysis(imageData, {
    page: 1,
    pageText: pageText.items || pageText,
    instrument,
    dense: id.includes('dense'),
  })

  const measureRecords = collectMeasureRecords(analysis)
  const byNumber = new Map(measureRecords.map((m) => [m.measureNumber, m]))

  const onsetByMeasure = new Map()
  for (const m of evalReport.measures || []) {
    const onsetDefects = (m.defects || []).filter((d) => d.code === 'onset-mismatch')
    if (!onsetDefects.length) continue
    onsetByMeasure.set(m.measureNumber, {
      measure: m,
      onsetDefects,
      allDefects: m.defects || [],
    })
  }

  // Pick sample measures: prefer configured, else top by onset count
  let sampleNums = target.sampleMeasures
  if (!sampleNums) {
    sampleNums = [...onsetByMeasure.entries()]
      .sort((a, b) => b[1].onsetDefects.length - a[1].onsetDefects.length)
      .slice(0, 4)
      .map(([n]) => n)
  }

  const samples = []
  const classCounts = {
    A_duration_cascade: 0,
    B_voice_separation: 0,
    C_chord_sequentialized: 0,
    D_rests: 0,
    E_tuplets: 0,
    F_beam_grouping: 0,
    G_measure_packing: 0,
  }
  // Classify ALL onset defects in fixture for share estimates
  for (const [mNum, pack] of onsetByMeasure) {
    const rec = byNumber.get(mNum)
    const events = (rec?.events || []).map(summarizeEvent)
    for (const defect of pack.onsetDefects) {
      const cls = classifyOnsetDefect(defect, events, null, null, pack.allDefects)
      classCounts[cls.primary] = (classCounts[cls.primary] || 0) + 1
    }
  }

  for (const mNum of sampleNums) {
    const pack = onsetByMeasure.get(mNum)
    const rec = byNumber.get(mNum)
    if (!pack) {
      samples.push({ measureNumber: mNum, note: 'no onset defects in eval for this measure' })
      continue
    }
    const events = (rec?.events || []).map(summarizeEvent)
    const noteheads = (rec?.notes || []).map((n) => ({
      midi: n.midi,
      pitch: midiName(n.midi),
      clef: n.clef,
      type: n.durationType,
      beams: n.beams,
      bStr: n.beamStrength,
      stem: n.stem?.length,
      hollowG: n.hollowGlyph,
      dotted: n.dotted,
      pos: n.positionInMeasure,
      cx: n.cx,
    }))
    const classified = pack.onsetDefects.map((d) => ({
      message: d.message,
      ...classifyOnsetDefect(d, events, null, null, pack.allDefects),
    }))
    samples.push({
      measureNumber: mNum,
      evalAlignment: pack.measure.alignment,
      defectCodes: Object.fromEntries(
        [...pack.allDefects.reduce((m, d) => m.set(d.code, (m.get(d.code) || 0) + 1), new Map())],
      ),
      onsetDefects: pack.onsetDefects.map((d) => d.message),
      classified,
      events,
      noteheads,
      source: analysis.source,
    })
  }

  const onsetTotal = evalReport.topDefects?.find((d) => d.code === 'onset-mismatch')?.count ?? 0
  const durTotal = evalReport.topDefects?.find((d) => d.code === 'duration-mismatch')?.count ?? 0
  const rhythm = evalReport.scorePercents?.rhythm ?? evalReport.classes?.rhythm?.percent

  const dump = {
    id,
    source: analysis.source,
    rhythm,
    onsetTotal,
    durTotal,
    classCounts,
    classShares: Object.fromEntries(
      Object.entries(classCounts).map(([k, v]) => [k, onsetTotal ? Number((v / onsetTotal).toFixed(3)) : 0]),
    ),
    samples,
    topDefects: evalReport.topDefects?.slice(0, 12),
    worstMeasures: evalReport.worstMeasures?.slice(0, 6),
  }

  writeFileSync(join(OUT, `${id}.onset-rca.json`), `${JSON.stringify(dump, null, 2)}\n`)
  writeFileSync(join(OUT, `${id}.omr.musicxml`), generatedMusicXml || '')

  console.log(
    `  source=${analysis.source} rhythm=${rhythm} onset=${onsetTotal} dur=${durTotal}`,
  )
  console.log('  classCounts', classCounts)
  for (const s of samples) {
    if (!s.events) {
      console.log(`  m${s.measureNumber}: ${s.note}`)
      continue
    }
    console.log(`\n  -- m${s.measureNumber} onset=${s.onsetDefects.length} defects=${JSON.stringify(s.defectCodes)}`)
    for (const c of s.classified.slice(0, 4)) {
      console.log(`     ${c.primary} | ${c.message}`)
    }
    for (const e of s.events) {
      console.log(
        `     ${e.type} @${e.start} d=${e.dur} ${e.dtype}${e.dotted ? '.' : ''} ${e.clef} [${(e.pitches || []).join(',')}] noteDur=${JSON.stringify(e.noteDur)} b=${JSON.stringify(e.beams)}/${JSON.stringify(e.bStr)} pos=${Number(e.pos).toFixed(3)} adj=${JSON.stringify(e.adj)}`,
      )
    }
  }
  return dump
}

const results = []
for (const t of TARGETS) {
  try {
    results.push(await runFixture(t))
  } catch (err) {
    console.error(`FAIL ${t.id}`, err)
    results.push({ id: t.id, error: String(err?.stack || err) })
  }
}

// Aggregate taxonomy
const agg = {
  A_duration_cascade: 0,
  B_voice_separation: 0,
  C_chord_sequentialized: 0,
  D_rests: 0,
  E_tuplets: 0,
  F_beam_grouping: 0,
  G_measure_packing: 0,
}
let onsetSum = 0
for (const r of results) {
  if (!r.classCounts) continue
  onsetSum += r.onsetTotal || 0
  for (const [k, v] of Object.entries(r.classCounts)) {
    agg[k] = (agg[k] || 0) + v
  }
}

const summary = {
  title: 'Rhythm Sprint 2 — Onset RCA',
  date: new Date().toISOString(),
  onsetSum,
  taxonomyCounts: agg,
  taxonomyShares: Object.fromEntries(
    Object.entries(agg).map(([k, v]) => [k, onsetSum ? Number((v / onsetSum).toFixed(3)) : 0]),
  ),
  fixtures: results.map((r) => ({
    id: r.id,
    source: r.source,
    rhythm: r.rhythm,
    onset: r.onsetTotal,
    dur: r.durTotal,
    classCounts: r.classCounts,
    error: r.error,
  })),
}
writeFileSync(join(OUT, 'taxonomy-aggregate.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log('\n==== AGGREGATE ====', JSON.stringify(summary, null, 2))
console.log('\ndone')
