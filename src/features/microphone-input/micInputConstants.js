export const MIC_SUPPORT = {
  SUPPORTED: 'supported',
  UNSUPPORTED: 'unsupported',
}

export const MIC_PERMISSION = {
  PROMPT: 'prompt',
  GRANTED: 'granted',
  DENIED: 'denied',
  ERROR: 'error',
  UNSUPPORTED: 'unsupported',
}

export const MIC_PERMISSION_LABELS = {
  [MIC_PERMISSION.PROMPT]: 'Not enabled',
  [MIC_PERMISSION.GRANTED]: 'Listening',
  [MIC_PERMISSION.DENIED]: 'Permission denied',
  [MIC_PERMISSION.ERROR]: 'Error',
  [MIC_PERMISSION.UNSUPPORTED]: 'Not supported',
}

export const WFY_INPUT_SOURCE = {
  MIDI: 'midi',
  MICROPHONE: 'microphone',
  MANUAL: 'manual',
}

export const WFY_INPUT_SOURCE_LABELS = {
  [WFY_INPUT_SOURCE.MIDI]: 'MIDI keyboard',
  [WFY_INPUT_SOURCE.MICROPHONE]: 'Microphone',
  [WFY_INPUT_SOURCE.MANUAL]: 'Manual continue',
}
