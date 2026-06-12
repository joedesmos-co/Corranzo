/**
 * Parse a Web MIDI message into note-on / note-off events.
 * @see https://www.w3.org/TR/webmidi/#midi-messages
 */
export function parseMidiMessage(data) {
  if (!data?.length) {
    return null
  }

  const status = data[0] & 0xf0
  const note = data[1]
  const velocity = data[2]

  if (status === 0x90 && velocity > 0) {
    return { type: 'noteon', midi: note, velocity }
  }

  if (status === 0x80 || (status === 0x90 && velocity === 0)) {
    return { type: 'noteoff', midi: note, velocity: velocity || 0 }
  }

  return null
}

export function isWebMidiSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'
}
