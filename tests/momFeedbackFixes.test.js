import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('Corranzo mom-test feedback pass', () => {
  it('opens contextual import help from the Help menu', () => {
    const app = readSrc('App.jsx')
    const flow = readSrc('components', 'library', 'ImportScoreView.jsx')
    expect(app.slice(app.indexOf('function showFileHelp'), app.indexOf('function handleTutorialAddSheetMusic'))).toContain("navigateToView('import')")
    expect(flow).toContain('A clear page.')
    expect(flow).toContain('Advanced · optional files & details')
  })

  it('keeps tutorial targets readable by cutting a clear hole around the target', () => {
    const tutorial = readSrc('components', 'onboarding', 'GuidedTutorial.jsx')
    const css = readSrc('App.css')

    expect(tutorial).toContain('getBackdropStyles')
    expect(tutorial).toContain('visibleTargetRect &&')
    expect(tutorial).toContain('guided-tour__backdrop--piece')
    expect(css).toContain('.guided-tour__backdrop--piece')
  })

  it('lets users remove optional notation and accompaniment files in Import', () => {
    const app = readSrc('App.jsx')
    const flow = readSrc('components', 'library', 'ImportScoreView.jsx')
    expect(app).toContain('const handleClearMusicXml = useCallback')
    expect(app).toContain('const handleClearMidi = useCallback')
    expect(flow).toContain('onClick={onClearMusicXml}')
    expect(flow).toContain('onClick={onClearMidi}')
    expect(flow).toContain('Remove notation file')
    expect(flow).toContain('Remove MIDI')
  })

  it('clears old timing and sound when a new PDF is uploaded', () => {
    const app = readSrc('App.jsx')

    expect(app).toContain('beginPdfScoreSourceReplacement')
    expect(app).toMatch(
      /beginPdfScoreSourceReplacement[\s\S]*setMusicXmlSource\(null\)[\s\S]*setMidiSource\(null\)/,
    )
    expect(app).toContain('pdfPreparingScoreMessage')
    expect(readSrc('features', 'library', 'autoOmrOrchestration.js')).toContain(
      'Previous timing and sound files were cleared',
    )
  })

  it('makes microphone-off and microphone-reality states explicit in Wait For You', () => {
    const waitForYou = readSrc('components', 'practice', 'WaitForYouSection.jsx')

    expect(waitForYou).toContain('Starting mic… stay quiet briefly.')
    expect(waitForYou).toContain('Start microphone')
    expect(waitForYou).toContain('isRollingChordMic')
    expect(waitForYou).toContain('wait-for-you__target-details')
  })

  it('defaults Wait For You to note mode and keeps beat stepping out of beginner UI', () => {
    const practiceSession = readSrc('features', 'practice', 'usePracticeSession.js')
    const waitForYou = readSrc('components', 'practice', 'WaitForYouSection.jsx')

    expect(practiceSession).toContain('prefs.checkpointMode === WFY_CHECKPOINT_MODE.BEAT')
    expect(waitForYou).not.toContain('Tap through beats')
    expect(waitForYou).not.toContain('name="wfy-checkpoint-mode"')
  })

  it('advances immediately for accepted input and manual Continue', () => {
    const waitForYouHook = readSrc('features', 'practice', 'useWaitForYou.js')
    const practiceSession = readSrc('features', 'practice', 'usePracticeSession.js')

    expect(waitForYouHook).toContain('markCorrectAndContinue({ immediate: true })')
    expect(practiceSession).toContain("onRecordWfyEvent?.('manual-continue')")
    expect(practiceSession).toContain('waitForYou.markCorrectAndContinue({ immediate: true })')
  })

  it('uses the main instrument voice for Hear it and exposes clear failure copy', () => {
    const player = readSrc('features', 'practice', 'referenceNotePlayer.js')
    const hook = readSrc('features', 'practice', 'useWaitForYouReferencePlayback.js')
    const waitForYou = readSrc('components', 'practice', 'WaitForYouSection.jsx')

    // Reference playback resolves the real sampled voice through the
    // instrument voice registry (piano by default) — never a bare synth.
    expect(player).toContain('loadInstrumentVoiceModule')
    expect(player).toContain('createInstrumentVoice({ tone: Tone })')
    expect(player).not.toContain('new Tone.PolySynth')
    expect(hook).toContain('reference sound unavailable')
    expect(waitForYou).toContain('wait-for-you__reference-error')
  })

  it('states that PDF-only generated scores are experimental', () => {
    const guide = readSrc('components', 'LibraryAccuracyGuide.jsx')
    const accuracy = readSrc('features', 'import', 'accuracyGuide.js')

    expect(guide).toContain('PDF-only generated scores are experimental')
    expect(guide).toContain('PDF')
    expect(guide).toContain('plus a timing file')
    expect(accuracy).toContain('PDF-only generated scores are experimental')
    expect(accuracy).toContain('PDF + a timing file')
  })
})
