/**
 * Experimental vector recognition client.
 *
 * This is opt-in only (see experimentalVisionFlag.js). It never runs for the
 * standard user path and never replaces the existing image/vector OMR
 * pipeline. The caller falls back to standard preparation on any failure.
 */
import {
  EXPERIMENTAL_VISION_MODES,
  getExperimentalVisionMode,
} from './experimentalVisionFlag.js'
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs'
import { resolveOmrPdfSource } from '../omr/omrPdfSource.js'
import { buildArrangementMusicXml } from '../audio-vision/arrangementMusicXml.js'
import {
  recognizePianoVectorPdf,
  assessPianoVectorIr,
  toMusicXML as pianoMusicXml,
} from './pianoVectorCore.js'
import {
  recognizeGuitarTabPdf,
  assessGuitarTabRecognition,
} from './guitarTabCore.js'

async function pdfPageCount(data) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise
  const count = doc.numPages
  try { await doc.destroy() } catch { /* already destroyed */ }
  return count
}

function abortError() {
  return new DOMException('OMR generation cancelled.', 'AbortError')
}

function warningQuality(assessment) {
  return {
    acceptance: 'warning',
    confidenceBand: assessment.practiceReady ? 'medium' : 'low',
    warningReasons: assessment.warnings ?? [],
    overallConfidence: assessment.practiceReady ? 0.8 : 0.45,
    extractionSummary: {
      noteCount: assessment.noteCount,
      measureCount: assessment.measureCount,
      durationSeconds: null,
      engine: assessment.engine,
    },
    safetyChecks: {
      experimental: true,
      practiceReady: assessment.practiceReady,
      completeFidelity: assessment.completeFidelity,
    },
  }
}

const GUITAR_TUNING = [64, 59, 55, 50, 45, 40]

function guitarEventsToArrangement(recognition, title) {
  const events = recognition?.events ?? []
  const signature = String(recognition?.summary?.rhythm?.time_signature ?? '4/4')
  const [beatsText, unitText] = signature.split('/')
  const beats = Math.max(1, Number(beatsText) || 4)
  const unit = Math.max(1, Number(unitText) || 4)
  const beatsPerMeasure = beats * 4 / unit
  const byMeasure = new Map()
  for (const event of events) {
    if (!byMeasure.has(event.measure)) byMeasure.set(event.measure, [])
    byMeasure.get(event.measure).push(event)
  }
  const arranged = []
  for (const measure of [...byMeasure.keys()].sort((a, b) => a - b)) {
    const list = byMeasure.get(measure).sort((a, b) => a.x - b.x || a.string - b.string)
    let cursor = 0
    let onsetStart = 0
    let lastX = null
    for (const event of list) {
      const isChord = lastX != null && Math.abs(event.x - lastX) <= 1.5
      if (!isChord) {
        cursor = Math.min(beatsPerMeasure - 0.125, Math.max(0, cursor))
        onsetStart = cursor
        lastX = event.x
      }
      const duration = Number(event.rhythm?.duration)
      const durBeats = Number.isFinite(duration) && duration > 0 ? duration : 1
      arranged.push({
        midi: event.midi ?? (GUITAR_TUNING[event.string - 1] ?? 0) + (event.fret ?? 0),
        startBeat: (measure - 1) * beatsPerMeasure + onsetStart,
        durBeats: Math.min(durBeats, Math.max(0.125, beatsPerMeasure - cursor)),
        string: event.string,
        fret: event.fret,
        role: 'melody',
      })
      if (!isChord) cursor += durBeats
    }
  }
  return buildArrangementMusicXml({
    events: arranged,
    targetPart: 'solo-guitar',
    bpm: 120,
    beatsPerMeasure,
    title,
  })
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function withWorkTitle(xml, title) {
  if (!title || /<work\b/i.test(xml)) return xml
  return xml.replace(/<score-partwise([^>]*)>/, `<score-partwise$1><work><work-title>${escapeXml(title)}</work-title></work>`)
}

function makeResult({ xml, assessment, title, instrumentId }) {
  xml = withWorkTitle(xml, title)
  if (!xml || typeof xml !== 'string') {
    return {
      ok: false,
      code: 'experimental-vector-empty',
      message: 'The experimental recognizer produced no notation.',
    }
  }
  const diagnostics = {
    experimentalVision: assessment,
    warnings: assessment.warnings ?? [],
  }
  return {
    ok: true,
    musicXml: xml,
    noteCount: assessment.noteCount,
    measureCount: assessment.measureCount,
    diagnostics,
    warnings: assessment.warnings ?? [],
    acceptance: 'warning',
    quality: warningQuality(assessment),
    overallConfidence: assessment.practiceReady ? 0.8 : 0.45,
    title,
    instrumentId,
    experimentalVision: assessment,
  }
}

/**
 * Run the opt-in recognizer. Returns `{ok:true,result}` or an honest failure
 * that the caller can report before falling back to standard preparation.
 */
export async function runExperimentalVisionRecognition({
  pdfSource = null,
  pdfFileUrl = null,
  instrumentId = 'piano',
  title = null,
  signal = null,
  traceRunId = null,
  onProgress = null,
} = {}) {
  const mode = getExperimentalVisionMode()
  if (!mode) return { ok: false, code: 'experimental-vision-off', message: 'Experimental recognition is off.' }
  const expectedInstrument =
    mode === EXPERIMENTAL_VISION_MODES.PIANO ? 'piano' : 'guitar'
  if (instrumentId !== expectedInstrument) {
    return {
      ok: false,
      code: 'experimental-vision-instrument-mismatch',
      message: `Experimental ${mode} recognition is selected, but the active instrument is ${instrumentId}.`,
    }
  }

  if (signal?.aborted) throw abortError()
  onProgress?.({ label: 'Reading the PDF with experimental vector recognition…', step: 0, total: 2 })
  const resolved = await resolveOmrPdfSource({ pdfSource, pdfFileUrl, traceRunId })
  if (signal?.aborted) throw abortError()
  const bytes = resolved?.data ?? resolved
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) {
    return {
      ok: false,
      code: 'experimental-vector-source',
      message: 'The PDF bytes were not available for experimental recognition.',
    }
  }
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const pageCount = await pdfPageCount(data).catch(() => null)
  if (pageCount != null && pageCount > 1) {
    return {
      ok: false,
      code: 'experimental-multi-page-unsupported',
      message: `The experimental path currently supports single-page PDFs; this PDF has ${pageCount} pages.`,
    }
  }

  if (mode === EXPERIMENTAL_VISION_MODES.PIANO) {
    onProgress?.({ label: 'Reading vector piano glyphs…', step: 1, total: 2 })
    const ir = await recognizePianoVectorPdf(data, { pdfjsLib: pdfjs })
    if (signal?.aborted) throw abortError()
    const assessment = assessPianoVectorIr(ir)
    if (!(ir?.notes?.length > 0) || ir?.route !== 'vector') {
      return {
        ok: false,
        code: 'experimental-piano-unsupported',
        message: assessment.warnings[0] ?? 'This PDF has no readable vector piano staff.',
        assessment,
      }
    }
    const xml = pianoMusicXml(ir)
    onProgress?.({ label: 'Building experimental MusicXML…', step: 2, total: 2 })
    return { ok: true, result: makeResult({ xml, assessment, title: title || 'Experimental piano vector', instrumentId }) }
  }

  onProgress?.({ label: 'Reading digital TAB text and staff geometry…', step: 1, total: 2 })
  const recognition = await recognizeGuitarTabPdf(data, { pdfjsLib: pdfjs })
  if (signal?.aborted) throw abortError()
  const assessment = assessGuitarTabRecognition(recognition)
  if (!(recognition?.events?.length > 0)) {
    return {
      ok: false,
      code: 'experimental-guitar-unsupported',
      message: assessment.warnings[0] ?? 'This PDF has no readable digital TAB events.',
      assessment,
    }
  }
  if (!assessment.rhythmRecovered) {
    return {
      ok: false,
      code: 'experimental-guitar-rhythm-unverified',
      message: `${recognition.events.length} string/fret events were recognized, but timing could not be verified. Standard preparation will be used.`,
      assessment,
    }
  }
  onProgress?.({ label: 'Building experimental TAB MusicXML…', step: 2, total: 2 })
  let xml = recognition.xml
  try {
    xml = guitarEventsToArrangement(recognition, title || 'Experimental guitar TAB')
  } catch {
    // Keep the research core's TAB-only XML if the shared engraver cannot
    // serialize this event set; the practice gate still blocks it.
  }
  return { ok: true, result: makeResult({ xml, assessment, title: title || 'Experimental guitar TAB', instrumentId }) }
}
