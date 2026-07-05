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
 * Modal actions for first-time WFY input setup. Guitar omits "keyboard" wording
 * and lists Continue before optional MIDI.
 */
export function buildWfyInputModalActions({
  instrumentId = INSTRUMENT_IDS.PIANO,
  midiAvailable = false,
  microphoneAvailable = false,
} = {}) {
  const isGuitar = instrumentId === INSTRUMENT_IDS.GUITAR
  const actions = [
    {
      id: WFY_INPUT_SOURCE.MICROPHONE,
      label: 'Use Microphone',
      primary: true,
      quiet: false,
      disabled: !microphoneAvailable,
    },
    {
      id: WFY_INPUT_SOURCE.MANUAL,
      label: isGuitar ? 'Use Continue button' : 'Continue button',
      primary: false,
      quiet: isGuitar,
      disabled: false,
    },
  ]

  if (midiAvailable) {
    actions.push({
      id: WFY_INPUT_SOURCE.MIDI,
      label: isGuitar ? 'Use MIDI device' : 'Use MIDI Keyboard',
      primary: false,
      quiet: false,
      disabled: false,
    })
  }

  return actions
}

/**
 * In-panel selector options. Guitar keeps Mic + Continue primary; MIDI is optional.
 * Manual is not duplicated below the MIDI row.
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
