/**
 * Build an owned MusicXML byte payload safe for timing parse + session persistence.
 */
import {
  OMR_GENERATED_PLAYBACK_LIMITS,
  validateOmrGeneratedPlayback,
} from '../omr/validateOmrGeneratedPlayback.js'
import { normalizeOmrMeasureGridMetadata } from '../omr/omrMeasureGridMeta.js'
import { normalizeOmrSourceVisualMap } from '../omr/omrSourceVisualMap.js'
import { fnv1aHashHex } from '../library/scoreSourceContentIdentity.js'

function isFinitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0
}

const workTitleCache = new Map()

function decodeXmlText(source) {
  try {
    if (!source?.data) return null
    const bytes = new Uint8Array(source.data, 0, Math.min(source.data.byteLength, 1 << 20))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

function unescapeXmlEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Display title authored inside the MusicXML (<work><work-title>,
 * else <movement-title>), cached by content key so library renders stay
 * cheap and restored sessions re-derive it without schema changes.
 * Returns null when the file carries no usable title.
 */
export function getMusicXmlWorkTitle(source) {
  const key = musicXmlSourceKey(source)
  if (!key) return null
  if (workTitleCache.has(key)) return workTitleCache.get(key)
  let title = null
  const text = decodeXmlText(source)
  if (text) {
    const workBlock = /<work\b[^>]*>([\s\S]{0,2000}?)<\/work>/i.exec(text)
    const workTitle = workBlock ? /<work-title\b[^>]*>([\s\S]+?)<\/work-title>/i.exec(workBlock[1]) : null
    const movementTitle = /<movement-title\b[^>]*>([\s\S]+?)<\/movement-title>/i.exec(text)
    const raw = workTitle?.[1] ?? movementTitle?.[1] ?? null
    if (raw) {
      const cleaned = unescapeXmlEntities(raw).slice(0, 120)
      title = cleaned || null
    }
  }
  workTitleCache.set(key, title)
  return title
}

function isValidIsoDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function cloneOmrMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return null
  }
  const cloned = { ...meta }
  const measureGrid = normalizeOmrMeasureGridMetadata(meta.measureGrid)
  if (measureGrid) {
    cloned.measureGrid = measureGrid
  } else {
    delete cloned.measureGrid
  }
  const sourceVisualMap = normalizeOmrSourceVisualMap(meta.sourceVisualMap)
  if (sourceVisualMap) {
    cloned.sourceVisualMap = sourceVisualMap
  } else {
    delete cloned.sourceVisualMap
  }
  return cloned
}

export function createMusicXmlSource(
  fileName,
  musicXmlString,
  { source = 'upload', omrMeta = null, ownerPdfIdentity = null } = {},
) {
  const encoded = new TextEncoder().encode(musicXmlString ?? '')
  const data = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
  const clonedOmrMeta = cloneOmrMeta(omrMeta)
  return {
    fileName,
    data,
    source,
    ...(ownerPdfIdentity ? { ownerPdfIdentity } : {}),
    ...(clonedOmrMeta ? { omrMeta: clonedOmrMeta } : {}),
  }
}

export function isMusicXmlSourceReady(source) {
  if (!source?.data) {
    return false
  }
  try {
    return source.data.byteLength > 0
  } catch {
    return false
  }
}

export function describeMusicXmlSource(source) {
  if (!source) {
    return { ready: false, fileName: null, byteLength: 0, source: null }
  }
  let byteLength = 0
  let ready = false
  try {
    byteLength = source.data?.byteLength ?? 0
    ready = byteLength > 0
  } catch {
    // keep defaults
  }
  return {
    ready,
    fileName: source.fileName ?? null,
    byteLength,
    source: source.source ?? 'upload',
  }
}

export function musicXmlSourceKey(source) {
  const summary = describeMusicXmlSource(source)
  if (!summary.ready) {
    return null
  }
  const contentHash = fnv1aHashHex(source.data) ?? '0'
  const owner = source?.ownerPdfIdentity ?? 'unowned'
  const omrDuration = source?.omrMeta?.durationSeconds
  const omrSuffix =
    summary.source === 'omr' && omrDuration != null ? `:dur${omrDuration}` : ''
  // Content hash is required — filename + byteLength alone can collide across pieces.
  return `${summary.fileName ?? 'score.musicxml'}:${summary.byteLength}:${summary.source ?? 'upload'}:${contentHash}:${owner}${omrSuffix}`
}

export function isOmrGeneratedPlayback(source) {
  return source?.source === 'omr'
}

/**
 * Retained only so sessions saved while standalone MusicXML/MXL importing
 * existed are still recognised on restore: the notation bytes are loaded, but
 * the source is no longer treated as practice-ready without a PDF. New uploads
 * never create this kind.
 */
export const UPLOAD_MUSICXML_SOURCE = 'upload-musicxml'

/** True for sources whose practice surface legitimately has no PDF page of its own. */
export function isPdflessNotationSource(source) {
  // A9 — audio arrangements carry no PDF (there is no page to read); every
  // other source requires the PDF that the musician reads from.
  return source?.source === 'audio-arrangement'
}


export function clearOmrGeneratedPlaybackSource(source) {
  return isOmrGeneratedPlayback(source) ? null : source
}

export function validateOmrSourceMeta(source) {
  if (!isOmrGeneratedPlayback(source)) {
    return { ok: true }
  }
  const meta = source?.omrMeta
  if (!meta || typeof meta !== 'object') {
    return {
      ok: false,
      message: 'Restored experimental playback metadata was missing — regenerate from PDF in Library.',
    }
  }
  if (!source?.fileName || typeof source.fileName !== 'string') {
    return {
      ok: false,
      message: 'Restored experimental playback file was incomplete — regenerate from PDF in Library.',
    }
  }
  if (!isFinitePositive(meta.durationSeconds)) {
    return {
      ok: false,
      message: 'Restored experimental playback metadata was invalid — regenerate from PDF in Library.',
    }
  }
  if (Number(meta.durationSeconds) > OMR_GENERATED_PLAYBACK_LIMITS.maxDurationSeconds) {
    return {
      ok: false,
      message: 'Restored experimental playback was too long to open safely — regenerate from PDF in Library.',
    }
  }
  if (!isFinitePositive(meta.noteCount) || Number(meta.noteCount) > OMR_GENERATED_PLAYBACK_LIMITS.maxNoteCount) {
    return {
      ok: false,
      message: 'Restored experimental playback note data was invalid — regenerate from PDF in Library.',
    }
  }
  if (
    !isFinitePositive(meta.measureCount) ||
    Number(meta.measureCount) > OMR_GENERATED_PLAYBACK_LIMITS.maxMeasureCount
  ) {
    return {
      ok: false,
      message: 'Restored experimental playback measure data was invalid — regenerate from PDF in Library.',
    }
  }
  if (typeof meta.title !== 'string' || meta.title.trim().length === 0) {
    return {
      ok: false,
      message: 'Restored experimental playback title was missing — regenerate from PDF in Library.',
    }
  }
  if (typeof meta.pdfFingerprint !== 'string' || meta.pdfFingerprint.trim().length === 0) {
    return {
      ok: false,
      message: 'Restored experimental playback PDF link was missing — regenerate from PDF in Library.',
    }
  }
  if (!isValidIsoDate(meta.createdAt)) {
    return {
      ok: false,
      message: 'Restored experimental playback timestamp was invalid — regenerate from PDF in Library.',
    }
  }
  // Musical validity: OMR-generated MusicXML must have measures that fill their
  // time signature. Grossly malformed transcription (e.g. every measure wrong)
  // is not practice-ready even when structural metadata passes.
  try {
    if (source?.data) {
      const bytes = source.data instanceof ArrayBuffer ? new Uint8Array(source.data) : new Uint8Array(source.data)
      const xml = new TextDecoder().decode(bytes)
      const rhythmCheck = validateOmrMusicXmlMeasureRhythm(xml)
      if (!rhythmCheck.ok) {
        return {
          ok: false,
          message: 'Generated score measures do not match the time signature — review before practicing.',
        }
      }
    }
  } catch {
    // Do not block on a parse failure of the validity check itself.
  }
  return { ok: true }
}

export function isPracticePlaybackReady({ restoreGateOpen, pdfFile, musicXmlSource }) {
  if (!restoreGateOpen || !isMusicXmlSourceReady(musicXmlSource)) {
    return false
  }
  // A9 — audio arrangements carry no PDF; timing-ready notation opens practice.
  if (isPdflessNotationSource(musicXmlSource)) {
    return true
  }
  if (!pdfFile) {
    return false
  }
  if (isOmrGeneratedPlayback(musicXmlSource)) {
    const meta = validateOmrSourceMeta(musicXmlSource)
    if (!meta.ok) return false
    // Practice requires ALL measures to be correct (0 bad), not just
    // "few enough to pass import". Preview may tolerate cross-staff artifacts.
    if (musicXmlSource?.data) {
      try {
        const bytes = musicXmlSource.data instanceof ArrayBuffer
          ? new Uint8Array(musicXmlSource.data)
          : new Uint8Array(musicXmlSource.data)
        const xml = new TextDecoder().decode(bytes)
        const strict = validateOmrMusicXmlMeasureRhythmStrict(xml)
        return strict.ok
      } catch {
        // Do not block on parse failure.
      }
    }
    return true
  }
  return true
}

/** Uploaded MusicXML/MXL (not experimental PDF playback). */
export function hasUploadedScoreTiming(musicXmlSource) {
  return isMusicXmlSourceReady(musicXmlSource) && !isOmrGeneratedPlayback(musicXmlSource)
}

/** Score timing is loaded and valid enough for Library Practice workflow. */
export function isLibraryScoreTimingReady(musicXmlSource) {
  if (!isMusicXmlSourceReady(musicXmlSource)) {
    return false
  }
  if (isOmrGeneratedPlayback(musicXmlSource)) {
    return validateOmrSourceMeta(musicXmlSource).ok
  }
  return true
}

/**
 * Experimental OMR panel: PDF-only, failed OMR retry, or invalid generated playback.
 * Hidden when uploaded MusicXML/MXL is ready, or valid OMR playback already exists.
 */
export function shouldShowLibraryOmrPanel({ hasPdf, musicXmlSource, pdfIdentity = null }) {
  if (!hasPdf) {
    return false
  }
  if (hasUploadedScoreTiming(musicXmlSource)) {
    return false
  }
  // Stale OMR owned by a different PDF must not hide prepare — re-run for the active PDF.
  if (
    musicXmlSource?.ownerPdfIdentity &&
    pdfIdentity &&
    musicXmlSource.ownerPdfIdentity !== pdfIdentity
  ) {
    return true
  }
  if (isOmrGeneratedPlayback(musicXmlSource) && isLibraryScoreTimingReady(musicXmlSource)) {
    return false
  }
  return true
}

export function cloneMusicXmlSource(source) {
  if (!source?.data) {
    return null
  }
  try {
    const data = source.data.slice(0)
    return {
      fileName: source.fileName ?? null,
      data,
      source: source.source ?? 'upload',
      ...(source.ownerPdfIdentity ? { ownerPdfIdentity: source.ownerPdfIdentity } : {}),
      ...(source.omrMeta ? { omrMeta: cloneOmrMeta(source.omrMeta) } : {}),
    }
  } catch {
    return null
  }
}

export function rebuildMusicXmlSourceFromSessionMeta(fileName, data, meta = {}) {
  if (!fileName || !data) {
    return null
  }
  const source = meta.musicXmlSourceKind ?? meta.musicXmlSource ?? 'upload'
  return {
    fileName,
    data: data.slice(0),
    source,
    ...(meta.ownerPdfIdentity || meta.musicXmlOwnerPdfIdentity
      ? { ownerPdfIdentity: meta.ownerPdfIdentity ?? meta.musicXmlOwnerPdfIdentity }
      : {}),
    ...(meta.omrMeta ? { omrMeta: cloneOmrMeta(meta.omrMeta) } : {}),
  }
}

export function validateRestoredOmrPlayback(source) {
  if (!isOmrGeneratedPlayback(source)) {
    return { ok: true }
  }
  if (!isMusicXmlSourceReady(source)) {
    return {
      ok: false,
      message: 'Restored experimental playback was incomplete — regenerate from PDF in Library.',
    }
  }
  const metaValidation = validateOmrSourceMeta(source)
  if (!metaValidation.ok) {
    return metaValidation
  }
  try {
    const musicXml = new TextDecoder().decode(source.data)
    return validateOmrGeneratedPlayback(musicXml, source.fileName)
  } catch {
    return {
      ok: false,
      message: 'Restored experimental playback could not be read — regenerate from PDF in Library.',
    }
  }
}

/**
 * Lightweight musical-validity check for OMR-generated MusicXML.
 *
 * Parses each <measure> block and verifies that every non-leading measure fills
 * its stated time signature on every staff. A leading partial measure is
 * allowed (pickup). Chord notes share the previous note's duration and are not
 * double-counted. Returns { ok, badMeasures, totalMeasures }.
 *
 * This is deliberately structural (measure fill), not a claim of musical
 * correctness: it catches grossly malformed transcription (e.g. every measure
 * wrong) without inventing an accuracy percentage.
 */
export function validateOmrMusicXmlMeasureRhythm(xmlString) {
  if (typeof xmlString !== 'string' || xmlString.length === 0) {
    return { ok: true, badMeasures: 0, totalMeasures: 0 }
  }
  const measureRegex = /<measure\b[^>]*>([\s\S]*?)<\/measure>/g
  const measures = []
  let match
  while ((match = measureRegex.exec(xmlString)) !== null) {
    measures.push(match[1])
  }
  if (measures.length === 0) {
    return { ok: true, badMeasures: 0, totalMeasures: 0 }
  }
  let divisions = 0
  let beats = 4
  let beatType = 4
  let badCount = 0
  let nonLeadingBadCount = 0
  measures.forEach((body, index) => {
    const divMatch = body.match(/<divisions>(\d+)<\/divisions>/)
    if (divMatch) divisions = Number(divMatch[1])
    const beatsMatch = body.match(/<beats>(\d+)<\/beats>/)
    const beatTypeMatch = body.match(/<beat-type>(\d+)<\/beat-type>/)
    if (beatsMatch) beats = Number(beatsMatch[1])
    if (beatTypeMatch) beatType = Number(beatTypeMatch[1])
    if (!divisions || !beats || !beatType) {
      // Cannot validate this measure; do not penalise.
      return
    }
    const target = (beats * divisions * 4) / beatType
    const byStaff = new Map()
    const noteRegex = /<note\b[^>]*>([\s\S]*?)<\/note>/g
    let noteMatch
    while ((noteMatch = noteRegex.exec(body)) !== null) {
      const noteBody = noteMatch[1]
      const durMatch = noteBody.match(/<duration>(\d+)<\/duration>/)
      if (!durMatch) continue
      if (/<chord\s*\/>/.test(noteBody)) continue
      if (/<grace\b/.test(noteBody)) continue
      const staffMatch = noteBody.match(/<staff>(\d+)<\/staff>/)
      const staff = staffMatch ? Number(staffMatch[1]) : 1
      const dur = Number(durMatch[1])
      byStaff.set(staff, (byStaff.get(staff) ?? 0) + dur)
    }
    if (byStaff.size === 0) return
    // Leading (first) measure may be a pickup: allow any sum <= target.
    const isLeading = index === 0
    let measureBad = false
    for (const sum of byStaff.values()) {
      const diff = Math.abs(sum - target)
      if (diff > 1) {
        if (isLeading && sum < target) {
          // Plausible pickup: partial leading measure.
          continue
        }
        measureBad = true
      }
    }
    if (measureBad) {
      badCount += 1
      if (!isLeading) nonLeadingBadCount += 1
    }
  })
  // Strict per-staff fill check. Cross-staff notation can leave up to two
  // non-leading measures per-staff imbalanced, so tolerate fewer than three
  // bad non-leading measures to avoid false-rejecting legitimate cross-staff
  // scores while still catching grossly malformed transcription.
  // Cross-staff notation can leave measures imbalanced. For longer scores
  // (multi-page arrangements) the absolute count of such artifacts scales
  // with score length, so use a percentage-based threshold capped at 10.
  // Allow up to 5% of measures to be bad, always at least 3 for short
  // scores, never more than 10 regardless of length. This tolerates
  // cross-staff artifacts without admitting grossly malformed transcription.
  const maxBadMeasures = Math.min(10, Math.max(3, Math.ceil(measures.length * 0.05)))
  return { ok: nonLeadingBadCount < maxBadMeasures, badMeasures: badCount, totalMeasures: measures.length }
}

/**
 * Strict measure-rhythm validation for Practice readiness.
 *
 * Import may tolerate a small number of imbalanced measures (cross-staff
 * artifacts, pickup ambiguity), but Practice requires every non-leading
 * measure to fill its time signature exactly. A single bad measure means the
 * score-follow cursor and Wait For You checkpoints would be wrong for that
 * measure, so the score is preview-only until corrected.
 */
export function validateOmrMusicXmlMeasureRhythmStrict(xmlString) {
  const result = validateOmrMusicXmlMeasureRhythm(xmlString)
  return { ...result, ok: result.badMeasures === 0 }
}
