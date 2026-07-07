import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  practiceInputSourceIsReady,
  shouldShowPracticeInputSourceModal,
} from '../src/features/practice/waitForYouInputSourceSession.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('Practice input-source modal state', () => {
  it('opens when entering Practice before a source was selected this session', () => {
    expect(
      shouldShowPracticeInputSourceModal({
        practiceActive: true,
        sourceSelectedThisSession: false,
      }),
    ).toBe(true)
  })

  it('does not reopen after a source choice', () => {
    expect(
      shouldShowPracticeInputSourceModal({
        practiceActive: true,
        sourceSelectedThisSession: true,
      }),
    ).toBe(false)
    expect(
      practiceInputSourceIsReady({
        sourceSelectedThisSession: true,
      }),
    ).toBe(true)
  })

  it('does not open when Practice is inactive', () => {
    expect(
      shouldShowPracticeInputSourceModal({
        practiceActive: false,
        sourceSelectedThisSession: false,
      }),
    ).toBe(false)
  })
})

describe('Practice input-source modal wiring', () => {
  const session = readSrc('features', 'practice', 'usePracticeSession.js')
  const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
  const modal = readSrc('components', 'practice', 'WaitForYouInputSourceModal.jsx')
  const options = readSrc('features', 'practice', 'wfyInputSourceOptions.js')
  const section = readSrc('components', 'practice', 'WaitForYouSection.jsx')

  it('renders the required modal title and choices', () => {
    expect(modal).toContain('How should Corranzo hear you?')
    expect(modal).toContain('buildWfyInputModalLayout')
    expect(modal).toContain('instrumentId')
    expect(modal).toContain('onChooseSource(action.id)')
    expect(modal).toContain('role="dialog"')
    expect(modal).toContain('aria-modal="true"')
  })

  it('guitar modal shows Microphone only with no fallback or advanced MIDI', () => {
    expect(modal).toContain("layout.layout === 'guitar'")
    expect(modal).not.toContain('layout.fallbackLink')
    expect(modal).not.toContain('Practice without mic')
    expect(options).toContain('buildWfyInputModalLayout')
    expect(options).toContain("layout: 'guitar'")
  })

  it('piano modal shows Microphone and MIDI keyboard only', () => {
    expect(modal).toContain("layout.layout === 'piano'")
    expect(options).toContain("layout: 'piano'")
    expect(options).toContain('Use MIDI Keyboard')
    expect(options).not.toContain('Practice without mic')
  })

  it('portals backdrop and dialog together to document.body', () => {
    expect(modal).toContain('createPortal')
    expect(modal).toContain('document.body')
    expect(modal).toContain('wfy-input-source-modal__scrim')
    expect(modal).toContain('wfy-input-source-modal__dialog')
    expect(modal).toMatch(/if \(!open\) \{\s*return null\s*\}/)
  })

  it('choosing Microphone closes the modal and starts mic calibration', () => {
    expect(options).toContain('WFY_INPUT_SOURCE.MICROPHONE')
    expect(modal).toContain('onChooseSource(action.id)')
    expect(session).toContain('setWfyInputSourceSelectedThisSession(true)')
    expect(session).toContain('showWfyInputSourceModal')
    expect(session).toMatch(
      /wfyInputSourceReady[\s\S]*WFY_INPUT_SOURCE\.MICROPHONE[\s\S]*microphone\.requestAccess\(\)/,
    )
  })

  it('choosing MIDI closes the modal and starts/listens MIDI', () => {
    expect(options).toContain('WFY_INPUT_SOURCE.MIDI')
    expect(session).toMatch(
      /listen:[\s\S]*wfyInputSourceReady[\s\S]*WFY_INPUT_SOURCE\.MIDI/,
    )
    expect(session).toMatch(
      /wfyInputSourceReady[\s\S]*WFY_INPUT_SOURCE\.MIDI[\s\S]*webMidi\.requestAccess\(\)/,
    )
  })

  it('keeps manual Continue available for non-piano/guitar instruments', () => {
    expect(options).toContain('WFY_INPUT_SOURCE.MANUAL')
    expect(session).toContain('source: WFY_INPUT_SOURCE.MANUAL')
    expect(section).toContain('Pauses at each note in your loop until you play it or tap Continue.')
    expect(section).toContain('className="wait-for-you__btn wait-for-you__btn--primary"')
  })

  it('keeps source changes available later from the side panel', () => {
    expect(panel).toContain('<WaitForYouInputSourceModal')
    expect(panel).toContain('<WaitForYouInputSourceSelector')
    expect(panel).toContain('onInputSourceChange={session.setWfyInputSource}')
    expect(panel).toContain('onChooseSource={session.setWfyInputSource}')
    expect(panel).toContain('instrumentId={session.instrumentId}')
    expect(section).not.toContain('<WaitForYouInputSourceSelector')
  })

  it('resets source-choice state when the score sources change', () => {
    expect(session).toMatch(
      /setWfyInputSourceSelectedThisSession\(false\)[\s\S]*sourcesRevision/,
    )
    expect(session).not.toMatch(
      /if \(!isWaitForYou\) \{[\s\S]*setWfyInputSourceSelectedThisSession\(false\)/,
    )
  })
})
