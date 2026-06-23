/**
 * Classify dropped/selected files for the single multi-file upload box, then
 * route each to the EXISTING import handler. This adds no parsing or timing
 * logic — it only sorts files by type and reuses the detectors the per-file
 * upload cards already use.
 *
 * Classification is extension-first because some browsers report a MIDI file's
 * MIME as application/octet-stream (which also appears in the score-timing MIME
 * list) — extension is the reliable discriminator. MIME is only a fallback when
 * there is no recognizable extension.
 */
import { isAcceptedFileType } from './fileImportLimits.js'
import { isAcceptedScoreTimingFile } from './sourceNotationFiles.js'

export const UPLOAD_KIND = {
  PDF: 'pdf',
  MUSICXML: 'musicXml',
  MIDI: 'midi',
  UNSUPPORTED: 'unsupported',
}

const PDF_EXTENSIONS = ['.pdf']
const MIDI_EXTENSIONS = ['.mid', '.midi']
// .mscz/.mscx are routed to the MusicXML handler, which shows the existing
// "MuseScore source planned" message — same behaviour as the dedicated card.
const SCORE_EXTENSIONS = ['.mxl', '.musicxml', '.xml', '.mscz', '.mscx']

function extensionOf(fileName = '') {
  const match = String(fileName).toLowerCase().match(/\.[a-z0-9]+$/)
  return match ? match[0] : ''
}

function hasExtension(file, extensions) {
  return extensions.includes(extensionOf(file?.name))
}

/** Classify a single file into one UPLOAD_KIND. */
export function classifyUploadFile(file) {
  if (!file) {
    return UPLOAD_KIND.UNSUPPORTED
  }

  if (hasExtension(file, PDF_EXTENSIONS)) {
    return UPLOAD_KIND.PDF
  }
  if (hasExtension(file, MIDI_EXTENSIONS)) {
    return UPLOAD_KIND.MIDI
  }
  if (hasExtension(file, SCORE_EXTENSIONS)) {
    return UPLOAD_KIND.MUSICXML
  }

  // No recognizable extension — fall back to the existing MIME-aware detectors.
  if (isAcceptedFileType(file, 'pdf')) {
    return UPLOAD_KIND.PDF
  }
  if (isAcceptedFileType(file, 'midi')) {
    return UPLOAD_KIND.MIDI
  }
  if (isAcceptedScoreTimingFile(file)) {
    return UPLOAD_KIND.MUSICXML
  }

  return UPLOAD_KIND.UNSUPPORTED
}

/**
 * Sort a FileList/array into { pdf, musicXml, midi, unsupported } arrays,
 * preserving selection order so "the first valid one" is deterministic.
 */
export function classifyUploadFiles(files) {
  const result = { pdf: [], musicXml: [], midi: [], unsupported: [] }
  for (const file of Array.from(files ?? [])) {
    const kind = classifyUploadFile(file)
    if (kind === UPLOAD_KIND.PDF) {
      result.pdf.push(file)
    } else if (kind === UPLOAD_KIND.MIDI) {
      result.midi.push(file)
    } else if (kind === UPLOAD_KIND.MUSICXML) {
      result.musicXml.push(file)
    } else {
      result.unsupported.push(file)
    }
  }
  return result
}

/** Short, user-facing notices for ignored extras and skipped files. */
export function buildUploadNotices(classified) {
  const notices = []
  if ((classified.pdf?.length ?? 0) > 1) {
    notices.push('Using the first PDF. Extra PDFs ignored.')
  }
  if ((classified.musicXml?.length ?? 0) > 1) {
    notices.push('Using the first score file. Extra score files ignored.')
  }
  if ((classified.midi?.length ?? 0) > 1) {
    notices.push('Using the first MIDI. Extra MIDI files ignored.')
  }
  for (const file of classified.unsupported ?? []) {
    notices.push(`Unsupported file skipped: ${file?.name ?? 'file'}`)
  }
  return notices
}

/**
 * Apply classified files to the existing import handlers (first valid of each
 * type). Returns the notices to display. The handlers are the SAME ones the
 * per-file cards use — no new import behaviour.
 */
export function applyClassifiedUploads(classified, { onPdf, onMusicXml, onMidi } = {}) {
  if (classified.pdf[0] && onPdf) {
    onPdf(classified.pdf[0])
  }
  if (classified.musicXml[0] && onMusicXml) {
    onMusicXml(classified.musicXml[0])
  }
  if (classified.midi[0] && onMidi) {
    onMidi(classified.midi[0])
  }
  return buildUploadNotices(classified)
}
