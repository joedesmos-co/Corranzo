import {
  getDemoPieceForInstrument,
  getFixtureFilenamesForInstrument,
  getFixturePathsForInstrument,
  getPracticeLibraryFixture,
} from './fixturePaths.js'
import { withTimeout } from '../utils/asyncWithTimeout.js'

const DEMO_FETCH_TIMEOUT_MS = 30_000

async function fetchAsFile(url, fileName, type) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Demo file not found: ${fileName} (${response.status})`)
  }
  const blob = await response.blob()
  return new File([blob], fileName, { type, lastModified: Date.now() })
}

/**
 * Loads a bundled practice piece for the active instrument — same shape as user uploads.
 */
export async function fetchSampleFixtureFiles(instrumentId, pieceId = null) {
  const fixture = pieceId ? getPracticeLibraryFixture(pieceId, instrumentId) : null
  const paths = fixture?.paths ?? getFixturePathsForInstrument(instrumentId)
  const fileNames = fixture?.fileNames ?? getFixtureFilenamesForInstrument(instrumentId)
  const meta = fixture ?? getDemoPieceForInstrument(instrumentId)
  return withTimeout(
    Promise.all([
      fetchAsFile(paths.pdf, fileNames.pdf, 'application/pdf'),
      fetchAsFile(paths.midi, fileNames.midi, 'audio/midi'),
      fetchAsFile(
        paths.musicXml,
        fileNames.musicXml,
        'application/vnd.recordare.musicxml',
      ),
    ]).then(([pdfFile, midiFile, musicXmlFile]) => ({
      pdfFile,
      midiFile,
      musicXmlFile,
      meta,
    })),
    DEMO_FETCH_TIMEOUT_MS,
    'Demo files took too long to load. Check your connection and try again.',
  )
}
