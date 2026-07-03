import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('launch readiness fixes', () => {
  it('does not abort batch upload when a MuseScore file is present', () => {
    const app = readSrc('App.jsx')
    const museScoreBlock = app.slice(
      app.indexOf('if (classified.musicXml[0])'),
      app.indexOf('if (classified.midi[0])'),
    )

    expect(museScoreBlock).toContain('isMuseScoreSourceFile(file)')
    expect(museScoreBlock).not.toMatch(/MUSESCORE_PLANNED_MESSAGE[\s\S]*return notices/)
  })

  it('skips misleading sound-file hint when MIDI is already loaded', () => {
    const app = readSrc('App.jsx')

    expect(app).toMatch(/message: midiSource[\s\S]*Opened Practice\./)
    expect(app).toContain('Add a sound file anytime for backing audio')
  })

  it('aligns Progress naming and explains both stat sources', () => {
    const topbar = readSrc('components', 'TopBar.jsx')
    const profile = readSrc('components', 'profile', 'ProfileView.jsx')

    expect(topbar).toContain("label: 'Progress'")
    expect(profile).toMatch(/>\s*Progress\s*<\/h2>/)
    expect(profile).toContain('tracks time automatically')
    expect(profile).not.toContain('only recorded when you log a session')
  })

  it('hides calibration debug from production diagnostics', () => {
    const panel = readSrc('components', 'practice', 'PracticeDiagnosticsPanel.jsx')

    expect(panel).toContain('import.meta.env.DEV && (')
    expect(panel).toContain('<summary>Calibration debug</summary>')
    expect(panel).not.toContain('Calibration debug (beta)')
  })

  it('shows legal footer on Practice view', () => {
    const app = readSrc('App.jsx')

    expect(app).toMatch(
      /activeView === 'library'[\s\S]*activeView === 'practice'[\s\S]*AppFooter/,
    )
  })

  it('surfaces PDF refresh failures to the user', () => {
    const app = readSrc('App.jsx')

    expect(app).toContain('setPdfSoftWarning(`PDF reload failed:')
  })

  it('fixes experimental OMR panel copy typo', () => {
    const omr = readSrc('components', 'library', 'PdfOmrPlaybackPanel.jsx')

    expect(omr).toContain('a timing file is still best when you have one.')
    expect(omr).not.toContain('A timing file is still best')
  })

  it('keeps the guided tutorial off Profile and legal views', () => {
    const app = readSrc('App.jsx')

    expect(app).toMatch(
      /guidedTutorialOpen[\s\S]*activeView === 'library' \|\| activeView === 'practice'/,
    )
  })

  it('restores legacy piano-era sessions to the piano instrument default', () => {
    const app = readSrc('App.jsx')

    expect(app).toContain('DEFAULT_INSTRUMENT_ID, normalizeInstrumentId')
    expect(app).toContain('normalizeInstrumentId(payload.instrumentId ?? DEFAULT_INSTRUMENT_ID)')
    expect(app).toContain('setInstrumentId(restoredInstrument)')
  })

  it('does not revoke instrument-scoped PDF blob URLs during instrument switches', () => {
    const app = readSrc('App.jsx')

    expect(app).not.toContain('URL.revokeObjectURL(pdfFile)')
    expect(app).toContain('instrumentBundleStoreRef.current.values()')
    expect(app).toMatch(/const pdfUrls = new Set\([\s\S]*URL\.revokeObjectURL\(pdfUrl\)/)
  })

  it('declares resetPdfViewerRuntime before applyInstrumentBundle to avoid TDZ crash', () => {
    const app = readSrc('App.jsx')
    const resetIdx = app.indexOf('const resetPdfViewerRuntime = useCallback')
    const applyIdx = app.indexOf('const applyInstrumentBundle = useCallback')
    expect(resetIdx).toBeGreaterThan(-1)
    expect(applyIdx).toBeGreaterThan(resetIdx)
  })

  it('clears Wait For You input feedback when mode becomes inactive', () => {
    const mic = readSrc('features', 'practice', 'useWaitForYouMicInput.js')
    const midi = readSrc('features', 'practice', 'useWaitForYouMidiInput.js')
    const guidance = readSrc('features', 'practice', 'useWaitForYouGuidance.js')
    const session = readSrc('features', 'practice', 'usePracticeSession.js')
    const pitch = readSrc('features', 'microphone-input', 'usePitchDetector.js')

    expect(mic).toMatch(/if \(!active\) \{[\s\S]*resetFeedback\(\)/)
    expect(midi).toMatch(/if \(!active\) \{[\s\S]*resetFeedback\(\)/)
    expect(guidance).toMatch(/if \(!active\) \{[\s\S]*setWrongAttempts\(0\)/)
    expect(session).toMatch(
      /useWaitForYouMicInput\(\{[\s\S]*active:[\s\S]*isWaitForYou &&[\s\S]*practiceActive/,
    )
    expect(session).toMatch(
      /micCaptureActive[\s\S]*isWaitForYou[\s\S]*WFY_INPUT_SOURCE\.MICROPHONE/,
    )
    expect(pitch).toMatch(/if \(!enabled\)[\s\S]*cancelAnimationFrame/)
    expect(pitch).toMatch(/resetNoteStabilizer\(stabilizerRef\.current\)/)
    expect(mic).toContain('resolveMicDiagnostic')
  })

  it('records manual practice with the instrument active when the timer started', () => {
    const manual = readSrc('components', 'profile', 'ManualPracticeLog.jsx')

    expect(manual).toContain('setSessionInstrumentId(instrumentId)')
    expect(manual).toContain('instrumentId: pendingSave.instrumentId')
  })
})
