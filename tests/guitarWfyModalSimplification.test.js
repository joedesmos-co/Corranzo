import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INSTRUMENT_IDS } from '../src/features/instruments/instruments.js'
import { WFY_INPUT_SOURCE } from '../src/features/microphone-input/micInputConstants.js'
import { buildWfyInputModalLayout } from '../src/features/practice/wfyInputSourceOptions.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

describe('guitar WFY input modal simplification', () => {
  it('only shows Use Microphone as the primary guitar modal action', () => {
    const layout = buildWfyInputModalLayout({
      instrumentId: INSTRUMENT_IDS.GUITAR,
      midiAvailable: true,
      microphoneAvailable: true,
    })
    expect(layout.primaryActions).toHaveLength(1)
    expect(layout.primaryActions[0].label).toBe('Use Microphone')
  })

  it('does not expose MIDI device in the default guitar modal actions', () => {
    const layout = buildWfyInputModalLayout({
      instrumentId: INSTRUMENT_IDS.GUITAR,
      midiAvailable: true,
      microphoneAvailable: true,
    })
    expect(layout.primaryActions.some((action) => action.id === WFY_INPUT_SOURCE.MIDI)).toBe(false)
    expect(layout.advancedActions.some((action) => action.id === WFY_INPUT_SOURCE.MIDI)).toBe(true)
  })

  it('does not expose Continue as a large guitar modal button', () => {
    const layout = buildWfyInputModalLayout({
      instrumentId: INSTRUMENT_IDS.GUITAR,
      midiAvailable: true,
      microphoneAvailable: true,
    })
    expect(layout.primaryActions.some((action) => action.id === WFY_INPUT_SOURCE.MANUAL)).toBe(false)
    expect(layout.fallbackLink?.label).toBe('Practice without mic')
    expect(layout.fallbackLink?.id).toBe(WFY_INPUT_SOURCE.MANUAL)
  })

  it('keeps piano modal primary actions for microphone, continue, and MIDI', () => {
    const layout = buildWfyInputModalLayout({
      instrumentId: INSTRUMENT_IDS.PIANO,
      midiAvailable: true,
      microphoneAvailable: true,
    })
    expect(layout.layout).toBe('standard')
    expect(layout.primaryActions.map((action) => action.id)).toEqual([
      WFY_INPUT_SOURCE.MICROPHONE,
      WFY_INPUT_SOURCE.MANUAL,
      WFY_INPUT_SOURCE.MIDI,
    ])
  })

  it('renders guitar fallback link and advanced MIDI in the modal component', () => {
    const modal = readSrc('components', 'practice', 'WaitForYouInputSourceModal.jsx')
    expect(modal).toContain('layout.fallbackLink.label')
    expect(modal).toContain('More options')
    expect(modal).toContain('wfy-input-source-modal__link')
    expect(modal).toContain('wfy-input-source-modal__advanced')
  })

  it('keeps side-panel source changes available after the modal closes', () => {
    const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
    const selector = readSrc('components', 'practice', 'WaitForYouInputSourceSelector.jsx')
    expect(panel).toContain('onInputSourceChange={session.setWfyInputSource}')
    expect(selector).toContain('buildWfyInputSelectorOptions')
    expect(selector).toContain('onInputSourceChange(option.id)')
  })
})
