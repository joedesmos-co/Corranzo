import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('Corranzo mom-test feedback pass', () => {
  it('opens the file help panel from the Help menu', () => {
    const app = readSrc('App.jsx')
    const library = readSrc('components', 'LibraryPanel.jsx')
    const guide = readSrc('components', 'LibraryAccuracyGuide.jsx')

    expect(app).toContain('setFileHelpSignal((signal) => signal + 1)')
    expect(app).toContain('fileHelpSignal={fileHelpSignal}')
    expect(library).toContain('openHelpSignal={fileHelpSignal}')
    expect(guide).toContain('detailsRef.current.open = true')
    expect(guide).toContain('Why a timing file helps')
  })

  it('keeps tutorial targets readable by cutting a clear hole around the target', () => {
    const tutorial = readSrc('components', 'onboarding', 'GuidedTutorial.jsx')
    const css = readSrc('App.css')

    expect(tutorial).toContain('getBackdropStyles')
    expect(tutorial).toContain('visibleTargetRect &&')
    expect(tutorial).toContain('guided-tour__backdrop--piece')
    expect(css).toContain('.guided-tour__backdrop--piece')
  })

  it('lets users remove timing and sound files from Library', () => {
    const app = readSrc('App.jsx')
    const multiUpload = readSrc('components', 'MultiFileUpload.jsx')
    const library = readSrc('components', 'LibraryPanel.jsx')

    expect(app).toContain('const handleClearMusicXml = useCallback')
    expect(app).toContain('const handleClearMidi = useCallback')
    expect(multiUpload).toContain('onClearMusicXml')
    expect(multiUpload).toContain('onClearMidi')
    expect(multiUpload).toContain('className="multi-upload__remove"')
    expect(library).toContain('Remove Timing File')
    expect(library).toContain('Remove Sound File')
  })

  it('clears old timing and sound when a new PDF is uploaded', () => {
    const app = readSrc('App.jsx')

    expect(app).toMatch(/const clearedCompanionFiles = Boolean\(midiSource \|\| musicXmlSource\)[\s\S]*setMusicXmlSource\(null\)[\s\S]*setMidiSource\(null\)/)
    expect(app).toMatch(/clearedCompanionFilesForPdf = Boolean\(loadedMidi \|\| loadedXml\)[\s\S]*setMidiSource\(null\)[\s\S]*setMusicXmlSource\(null\)/)
    expect(app).toContain('Previous timing and sound files were cleared')
  })

  it('makes microphone-off and microphone-reality states explicit in Wait For You', () => {
    const waitForYou = readSrc('components', 'practice', 'WaitForYouSection.jsx')

    expect(waitForYou).toContain('Microphone is off. Turn it on to have Wait For You listen.')
    expect(waitForYou).toContain('Enable microphone')
    expect(waitForYou).toContain('Microphone works best one note at a time')
    expect(waitForYou).toContain('MIDI is best for chords')
  })

  it('defaults Wait For You to note mode and keeps beat stepping out of beginner UI', () => {
    const practiceSession = readSrc('features', 'practice', 'usePracticeSession.js')
    const waitForYou = readSrc('components', 'practice', 'WaitForYouSection.jsx')

    expect(practiceSession).toContain('useState(WFY_CHECKPOINT_MODE.NOTE)')
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

  it('uses the main piano instrument for Hear it and exposes clear failure copy', () => {
    const player = readSrc('features', 'practice', 'referenceNotePlayer.js')
    const hook = readSrc('features', 'practice', 'useWaitForYouReferencePlayback.js')
    const waitForYou = readSrc('components', 'practice', 'WaitForYouSection.jsx')

    expect(player).toContain("await import('../playback/pianoInstrument.js')")
    expect(player).toContain('createPianoInstrument({ tone: Tone })')
    expect(player).not.toContain('new Tone.PolySynth')
    expect(hook).toContain('Piano reference sound unavailable')
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
