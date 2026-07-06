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
      return isGuitar ? 'Continue button' : 'Continue button'
    default:
      return 'Continue button'
  }
}

/**
 * First-time WFY modal layout. Guitar shows only Microphone up front; manual
 * continue is a text link and MIDI sits behind More options. Piano keeps the
 * three-button chooser when MIDI is available.
 */
export function buildWfyInputModalLayout({
  instrumentId = INSTRUMENT_IDS.PIANO,
  midiAvailable = false,
  microphoneAvailable = false,
} = {}) {
  const isGuitar = instrumentId === INSTRUMENT_IDS.GUITAR

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
      fallbackLink: {
        id: WFY_INPUT_SOURCE.MANUAL,
        label: 'Practice without mic',
      },
      advancedActions: midiAvailable
        ? [
            {
              id: WFY_INPUT_SOURCE.MIDI,
              label: 'Use MIDI device',
            },
          ]
        : [],
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
  if (layout.layout === 'guitar') {
    return layout.primaryActions.map((action) => ({ ...action, primary: true, quiet: false }))
  }
  return layout.primaryActions
}

/**
 * In-panel selector options. Guitar keeps Mic + Continue primary; MIDI is optional.
 */
export function buildWfyInputSelectorOptions({
  instrumentId = INSTRUMENT_IDS.PIANO,
  midiAvailable = false,
  microphoneAvailable = false,
} = {}) {
  const isGuitar = instrumentId === INSTRUMENT_IDS.GUITAR
  const options = [
    {
      id: WFY_INPUT_SOURCE.MICROPHONE,
      label: 'Use Microphone',
      hint: isGuitar ? 'Acoustic or electric guitar' : 'Acoustic or electric instruments',
      available: microphoneAvailable,
    },
    {
      id: WFY_INPUT_SOURCE.MANUAL,
      label: isGuitar ? 'Use Continue button' : 'Continue button',
      hint: 'No device needed',
      available: true,
    },
  ]

  if (midiAvailable) {
    options.push({
      id: WFY_INPUT_SOURCE.MIDI,
      label: isGuitar ? 'Use MIDI device' : 'Use MIDI',
      hint: isGuitar ? 'MIDI guitar or pickup' : 'Keyboards & digital pianos',
      available: true,
    })
  }

  return options
}
