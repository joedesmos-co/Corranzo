export const WEB_MIDI_SUPPORT = {
  SUPPORTED: 'supported',
  UNSUPPORTED: 'unsupported',
}

export const WEB_MIDI_PERMISSION = {
  UNSUPPORTED: 'unsupported',
  PROMPT: 'prompt',
  GRANTED: 'granted',
  DENIED: 'denied',
  ERROR: 'error',
}

export const WEB_MIDI_PERMISSION_LABELS = {
  [WEB_MIDI_PERMISSION.UNSUPPORTED]: 'Not supported in this browser',
  [WEB_MIDI_PERMISSION.PROMPT]: 'Permission required',
  [WEB_MIDI_PERMISSION.GRANTED]: 'Access granted',
  [WEB_MIDI_PERMISSION.DENIED]: 'Access denied',
  [WEB_MIDI_PERMISSION.ERROR]: 'Could not access MIDI',
}
