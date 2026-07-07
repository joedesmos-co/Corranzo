import { INSTRUMENT_IDS } from '../instruments/instruments.js'
import { WFY_INPUT_SOURCE } from '../microphone-input/micInputConstants.js'

export function wfyInputSourceLabel(source, instrumentId = INSTRUMENT_IDS.PIANO) {
  const isGuitar = instrumentId === INSTRUMENT_IDS.GUITAR
  switch (source) {
    case WFY_INPUT_SOURCE.MICROPHONE:
      return 'Microphone'
    case WFY_INPUT_SOURCE.MIDI:
      return isGuitar ? 'MIDI device' : 'MIDI keyboard'
    case WFY_INPUT_SOURCE.MANUAL:
      return 'Continue button'
    default:
      return 'Continue button'
  }
}

/**
 * First-time Practice modal layout.
 * Piano: Microphone + MIDI keyboard.
 * Guitar: Microphone only.
 */
export function buildWfyInputModalLayout({
  instrumentId = INSTRUMENT_IDS.PIANO,
  midiAvailable = false,
  microphoneAvailable = false,
} = {}) {
  const isGuitar = instrumentId === INSTRUMENT_IDS.GUITAR
  const isPiano = instrumentId === INSTRUMENT_IDS.PIANO

  if (isGuitar) {
    return {
      layout: 'guitar',
      primaryActions: [
        {
          id: WFY_INPUT_SOURCE.MICROPHONE,
          label: 'Use Microphone',
          disabled: !microphoneAvailable,
        },
      ],
      fallbackLink: null,
      advancedActions: [],
    }
  }

  if (isPiano) {
    const primaryActions = [
      {
        id: WFY_INPUT_SOURCE.MICROPHONE,
        label: 'Use Microphone',
        disabled: !microphoneAvailable,
      },
    ]
    if (midiAvailable) {
      primaryActions.push({
        id: WFY_INPUT_SOURCE.MIDI,
        label: 'Use MIDI Keyboard',
      })
    }
    return {
      layout: 'piano',
      primaryActions,
      fallbackLink: null,
      advancedActions: [],
    }
  }

  const primaryActions = [
    {
      id: WFY_INPUT_SOURCE.MICROPHONE,
      label: 'Use Microphone',
      primary: true,
      disabled: !microphoneAvailable,
    },
    {
      id: WFY_INPUT_SOURCE.MANUAL,
      label: 'Continue button',
      primary: false,
      disabled: false,
    },
  ]

  if (midiAvailable) {
    primaryActions.push({
      id: WFY_INPUT_SOURCE.MIDI,
      label: 'Use MIDI Keyboard',
      primary: false,
      disabled: false,
    })
  }

  return {
    layout: 'standard',
    primaryActions,
    fallbackLink: null,
    advancedActions: [],
  }
}

/** @deprecated Prefer buildWfyInputModalLayout — flat list for legacy callers. */
export function buildWfyInputModalActions(options = {}) {
  const layout = buildWfyInputModalLayout(options)
  if (layout.layout === 'guitar' || layout.layout === 'piano') {
    return layout.primaryActions.map((action) => ({ ...action, primary: true, quiet: false }))
  }
  return layout.primaryActions
}

/**
 * In-panel selector options. Default choices match the entry modal; extra
 * fallback sources stay available under Change for guitar and other instruments.
 */
export function buildWfyInputSelectorOptions({
  instrumentId = INSTRUMENT_IDS.PIANO,
  midiAvailable = false,
  microphoneAvailable = false,
} = {}) {
  const isGuitar = instrumentId === INSTRUMENT_IDS.GUITAR
  const isPiano = instrumentId === INSTRUMENT_IDS.PIANO
  const options = [
    {
      id: WFY_INPUT_SOURCE.MICROPHONE,
      label: 'Use Microphone',
      hint: isGuitar ? 'Acoustic or electric guitar' : isPiano ? 'Acoustic piano or keyboard' : 'Acoustic or electric instruments',
      available: microphoneAvailable,
    },
  ]

  if (isPiano && midiAvailable) {
    options.push({
      id: WFY_INPUT_SOURCE.MIDI,
      label: 'Use MIDI keyboard',
      hint: 'Keyboards & digital pianos',
      available: true,
    })
  }

  if (!isPiano && !isGuitar) {
    options.push({
      id: WFY_INPUT_SOURCE.MANUAL,
      label: 'Continue button',
      hint: 'No device needed',
      available: true,
    })
    if (midiAvailable) {
      options.push({
        id: WFY_INPUT_SOURCE.MIDI,
        label: 'Use MIDI',
        hint: 'Keyboards & digital pianos',
        available: true,
      })
    }
  }

  if (isGuitar) {
    if (midiAvailable) {
      options.push({
        id: WFY_INPUT_SOURCE.MIDI,
        label: 'Use MIDI device',
        hint: 'MIDI guitar or pickup',
        available: true,
        advanced: true,
      })
    }
    options.push({
      id: WFY_INPUT_SOURCE.MANUAL,
      label: 'Use Continue button',
      hint: 'No device needed',
      available: true,
      advanced: true,
    })
  }

  return options
}

export function buildWfyInputSelectorGroups(options = []) {
  const primary = options.filter((option) => !option.advanced)
  const advanced = options.filter((option) => option.advanced)
  return { primary, advanced }
}
