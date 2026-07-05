import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WFY_CHECKPOINT_MODE } from '../src/features/practice/waitForYouCheckpointMode.js'
import {
  shouldShowWaitForYouInputSourceModal,
  waitForYouInputSourceIsReady,
} from '../src/features/practice/waitForYouInputSourceSession.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('Wait For You input-source modal state', () => {
  it('opens on entering note-mode WFY when no source was selected this session', () => {
    expect(
      shouldShowWaitForYouInputSourceModal({
        isWaitForYou: true,
        checkpointMode: WFY_CHECKPOINT_MODE.NOTE,
        sourceSelectedThisSession: false,
      }),
    ).toBe(true)
  })

  it('does not reopen every checkpoint after a source choice', () => {
    expect(
      shouldShowWaitForYouInputSourceModal({
        isWaitForYou: true,
        checkpointMode: WFY_CHECKPOINT_MODE.NOTE,
        sourceSelectedThisSession: true,
      }),
    ).toBe(false)
    expect(
      waitForYouInputSourceIsReady({
        checkpointMode: WFY_CHECKPOINT_MODE.NOTE,
        sourceSelectedThisSession: true,
      }),
    ).toBe(true)
  })

  it('does not block beat-mode WFY, which only needs Continue', () => {
    expect(
      shouldShowWaitForYouInputSourceModal({
        isWaitForYou: true,
        checkpointMode: WFY_CHECKPOINT_MODE.BEAT,
        sourceSelectedThisSession: false,
      }),
    ).toBe(false)
  })
})

describe('Wait For You input-source modal wiring', () => {
  const session = readSrc('features', 'practice', 'usePracticeSession.js')
  const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
  const modal = readSrc('components', 'practice', 'WaitForYouInputSourceModal.jsx')
  const section = readSrc('components', 'practice', 'WaitForYouSection.jsx')

  it('renders the required modal title and choices', () => {
    expect(modal).toContain('How do you want to play?')
    expect(modal).toContain('Use Microphone')
    expect(modal).toContain('Use MIDI Keyboard')
    expect(modal).toContain('Continue button')
    expect(modal).toContain('role="dialog"')
    expect(modal).toContain('aria-modal="true"')
  })

  it('portals backdrop and dialog together to document.body', () => {
    expect(modal).toContain('createPortal')
    expect(modal).toContain('document.body')
    expect(modal).toContain('wfy-input-source-modal__scrim')
    expect(modal).toContain('wfy-input-source-modal__dialog')
    expect(modal).toMatch(/if \(!open\) \{\s*return null\s*\}/)
  })

  it('choosing Microphone closes the modal and starts mic calibration', () => {
    expect(modal).toContain('onChooseSource(WFY_INPUT_SOURCE.MICROPHONE)')
    expect(session).toContain('setWfyInputSourceSelectedThisSession(true)')
    expect(session).toContain('showWfyInputSourceModal')
    expect(session).toMatch(
      /wfyInputSourceReady[\s\S]*WFY_INPUT_SOURCE\.MICROPHONE[\s\S]*microphone\.requestAccess\(\)/,
    )
  })

  it('choosing MIDI closes the modal and starts/listens MIDI', () => {
    expect(modal).toContain('onChooseSource(WFY_INPUT_SOURCE.MIDI)')
    expect(session).toMatch(
      /listen:[\s\S]*wfyInputSourceReady[\s\S]*WFY_INPUT_SOURCE\.MIDI/,
    )
    expect(session).toMatch(
      /wfyInputSourceReady[\s\S]*WFY_INPUT_SOURCE\.MIDI[\s\S]*webMidi\.requestAccess\(\)/,
    )
  })

  it('choosing Continue closes the modal and keeps manual Continue available', () => {
    expect(modal).toContain('onChooseSource(WFY_INPUT_SOURCE.MANUAL)')
    expect(session).toContain('source: WFY_INPUT_SOURCE.MANUAL')
    expect(section).toContain('Pauses at each note in your loop until you play it or tap Continue.')
    expect(section).toContain('className="wait-for-you__btn wait-for-you__btn--primary"')
  })

  it('keeps source changes available later from the side panel', () => {
    expect(panel).toContain('<WaitForYouInputSourceModal')
    expect(panel).toContain('<WaitForYouSection')
    expect(panel).toContain('onInputSourceChange={session.setWfyInputSource}')
    expect(panel).toContain('onChooseSource={session.setWfyInputSource}')
  })

  it('resets source-choice state after leaving WFY', () => {
    expect(session).toMatch(
      /if \(!isWaitForYou\) \{[\s\S]*setWfyInputSourceSelectedThisSession\(false\)/,
    )
  })
})
