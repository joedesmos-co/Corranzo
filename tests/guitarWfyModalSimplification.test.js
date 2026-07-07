import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INSTRUMENT_IDS } from '../src/features/instruments/instruments.js'
import { WFY_INPUT_SOURCE } from '../src/features/microphone-input/micInputConstants.js'
import {
  buildWfyInputModalLayout,
  buildWfyInputSelectorOptions,
} from '../src/features/practice/wfyInputSourceOptions.js'

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

  it('does not expose MIDI device or Continue in the default guitar modal', () => {
    const layout = buildWfyInputModalLayout({
      instrumentId: INSTRUMENT_IDS.GUITAR,
      midiAvailable: true,
      microphoneAvailable: true,
    })
    expect(layout.primaryActions.some((action) => action.id === WFY_INPUT_SOURCE.MIDI)).toBe(false)
    expect(layout.primaryActions.some((action) => action.id === WFY_INPUT_SOURCE.MANUAL)).toBe(false)
    expect(layout.fallbackLink).toBeNull()
    expect(layout.advancedActions).toEqual([])
  })

  it('piano modal shows Microphone and MIDI keyboard only', () => {
    const layout = buildWfyInputModalLayout({
      instrumentId: INSTRUMENT_IDS.PIANO,
      midiAvailable: true,
      microphoneAvailable: true,
    })
    expect(layout.layout).toBe('piano')
    expect(layout.primaryActions.map((action) => action.label)).toEqual([
      'Use Microphone',
      'Use MIDI Keyboard',
    ])
    expect(layout.fallbackLink).toBeNull()
    expect(layout.advancedActions).toEqual([])
  })

  it('keeps guitar MIDI and Continue under More options in the side selector', () => {
    const options = buildWfyInputSelectorOptions({
      instrumentId: INSTRUMENT_IDS.GUITAR,
      midiAvailable: true,
      microphoneAvailable: true,
    })
    expect(options.filter((option) => !option.advanced).map((option) => option.label)).toEqual([
      'Use Microphone',
    ])
    expect(options.filter((option) => option.advanced).map((option) => option.label)).toEqual([
      'Use MIDI device',
      'Use Continue button',
    ])
  })

  it('renders simplified guitar and piano layouts in the modal component', () => {
    const modal = readSrc('components', 'practice', 'WaitForYouInputSourceModal.jsx')
    expect(modal).toContain("layout.layout === 'guitar'")
    expect(modal).toContain("layout.layout === 'piano'")
    expect(modal).not.toContain('layout.fallbackLink')
    expect(modal).not.toContain('Practice without mic')
  })

  it('keeps side-panel source changes available after the modal closes', () => {
    const panel = readSrc('components', 'practice', 'PracticeControlPanel.jsx')
    const selector = readSrc('components', 'practice', 'WaitForYouInputSourceSelector.jsx')
    expect(panel).toContain('onInputSourceChange={session.setWfyInputSource}')
    expect(selector).toContain('buildWfyInputSelectorOptions')
    expect(selector).toContain('onInputSourceChange(option.id)')
    expect(selector).toContain('More options')
  })
})
