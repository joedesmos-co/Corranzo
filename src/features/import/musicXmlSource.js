/**
 * Build an owned MusicXML byte payload safe for timing parse + session persistence.
 */
import {
  OMR_GENERATED_PLAYBACK_LIMITS,
  validateOmrGeneratedPlayback,
} from '../omr/validateOmrGeneratedPlayback.js'
import { normalizeOmrMeasureGridMetadata } from '../omr/omrMeasureGridMeta.js'

function isFinitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0
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
  return cloned
}

export function createMusicXmlSource(fileName, musicXmlString, { source = 'upload', omrMeta = null } = {}) {
  const encoded = new TextEncoder().encode(musicXmlString ?? '')
  const data = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)
  const clonedOmrMeta = cloneOmrMeta(omrMeta)
  return {
    fileName,
    data,
    source,
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
  const omrDuration = source?.omrMeta?.durationSeconds
  const omrSuffix =
    summary.source === 'omr' && omrDuration != null ? `:dur${omrDuration}` : ''
  return `${summary.fileName ?? 'score.musicxml'}:${summary.byteLength}:${summary.source ?? 'upload'}${omrSuffix}`
}

export function isOmrGeneratedPlayback(source) {
  return source?.source === 'omr'
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
  return { ok: true }
}

export function isPracticePlaybackReady({ restoreGateOpen, pdfFile, musicXmlSource }) {
  if (!restoreGateOpen || !pdfFile || !isMusicXmlSourceReady(musicXmlSource)) {
    return false
  }
  if (isOmrGeneratedPlayback(musicXmlSource)) {
    return validateOmrSourceMeta(musicXmlSource).ok
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
export function shouldShowLibraryOmrPanel({ hasPdf, musicXmlSource }) {
  if (!hasPdf) {
    return false
  }
  if (hasUploadedScoreTiming(musicXmlSource)) {
    return false
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
