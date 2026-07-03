import { DEMO_PIECE, FIXTURE_FILENAMES, FIXTURE_PATHS } from './fixturePaths.js'
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
 * Loads bundled demo piece (Hungarian Dance No. 5) — same shape as user uploads.
 */
export async function fetchSampleFixtureFiles() {
  return withTimeout(
    Promise.all([
      fetchAsFile(FIXTURE_PATHS.pdf, FIXTURE_FILENAMES.pdf, 'application/pdf'),
      fetchAsFile(FIXTURE_PATHS.midi, FIXTURE_FILENAMES.midi, 'audio/midi'),
      fetchAsFile(
        FIXTURE_PATHS.musicXml,
        FIXTURE_FILENAMES.musicXml,
        'application/vnd.recordare.musicxml',
      ),
    ]).then(([pdfFile, midiFile, musicXmlFile]) => ({
      pdfFile,
      midiFile,
      musicXmlFile,
      meta: DEMO_PIECE,
    })),
    DEMO_FETCH_TIMEOUT_MS,
    'Demo files took too long to load. Check your connection and try again.',
  )
}
