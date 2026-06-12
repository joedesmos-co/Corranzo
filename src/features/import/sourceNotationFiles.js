import { isMusicXmlFile } from '../musicxml/loadMusicXmlFile.js'

export const MUSESCORE_PLANNED_MESSAGE =
  'MuseScore source files (.mscz, .mscx) are planned. For now, export MusicXML or MXL from MuseScore for best accuracy.'

export const SCORE_TIMING_ROLE = {
  label: 'Score timing / source notation',
  shortLabel: 'Score timing',
  /** Parsed today for measure/beat intelligence */
  parsedExtensions: ['.mxl', '.musicxml', '.xml'],
  /** Accepted in the file picker; .mscz/.mscx show a planned message */
  plannedExtensions: ['.mscz', '.mscx'],
  acceptMime: [
    'application/vnd.recordare.musicxml+xml',
    'application/xml',
    'text/xml',
    'application/zip',
    'application/octet-stream',
  ],
}

export const SOUND_FILE_ROLE = {
  label: 'Sound file',
  extensions: ['.mid', '.midi'],
  acceptMime: ['audio/midi', 'audio/mid'],
}

export const SHEET_MUSIC_ROLE = {
  label: 'Sheet music',
  extensions: ['.pdf'],
  acceptMime: ['application/pdf'],
}

function matchesExtension(fileName, extensions) {
  const lower = fileName.toLowerCase()
  return extensions.some((ext) => lower.endsWith(ext))
}

export function isMuseScoreSourceFile(file) {
  if (!file?.name) {
    return false
  }
  return matchesExtension(file.name, SCORE_TIMING_ROLE.plannedExtensions)
}

/** Files ScoreFlow can parse into measure/beat timing today. */
export function isParsedScoreTimingFile(file) {
  return isMusicXmlFile(file)
}

/** All score-timing uploads allowed in the Library picker. */
export function isAcceptedScoreTimingFile(file) {
  if (!file) {
    return false
  }
  if (SCORE_TIMING_ROLE.acceptMime.includes(file.type)) {
    return true
  }
  return matchesExtension(file.name, [
    ...SCORE_TIMING_ROLE.parsedExtensions,
    ...SCORE_TIMING_ROLE.plannedExtensions,
  ])
}

export function buildAcceptAttribute(extensions, mimeTypes = []) {
  return [...mimeTypes, ...extensions].join(',')
}

export const ACCEPT_ATTRIBUTES = {
  sheetMusic: buildAcceptAttribute(
    SHEET_MUSIC_ROLE.extensions,
    SHEET_MUSIC_ROLE.acceptMime,
  ),
  scoreTiming: buildAcceptAttribute(
    [...SCORE_TIMING_ROLE.parsedExtensions, ...SCORE_TIMING_ROLE.plannedExtensions],
    SCORE_TIMING_ROLE.acceptMime,
  ),
  soundFile: buildAcceptAttribute(SOUND_FILE_ROLE.extensions, SOUND_FILE_ROLE.acceptMime),
}

export function formatScoreTimingExtensionsList() {
  return [...SCORE_TIMING_ROLE.plannedExtensions, ...SCORE_TIMING_ROLE.parsedExtensions]
    .join(', ')
}
