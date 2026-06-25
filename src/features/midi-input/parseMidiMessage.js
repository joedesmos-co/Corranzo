/**
 * Parse a Web MIDI message into note-on / note-off events.
 * @see https://www.w3.org/TR/webmidi/#midi-messages
 */
export function parseMidiMessage(data) {
  if (!data?.length) {
    return null
  }

  const status = data[0] & 0xf0
  const channel = data[0] & 0x0f
  const note = data[1]
  const velocity = data[2]

  if (status === 0x90 && velocity > 0) {
    return { type: 'noteon', midi: note, velocity, channel }
  }

  if (status === 0x80 || (status === 0x90 && velocity === 0)) {
    return { type: 'noteoff', midi: note, velocity: velocity || 0, channel }
  }

  // Control change. CC64 is the sustain (damper) pedal: value >= 64 = down.
  if (status === 0xb0) {
    const controller = data[1]
    const value = data[2]
    if (controller === 64) {
      return { type: 'sustain', controller, value, on: value >= 64, channel }
    }
    return { type: 'cc', controller, value, channel }
  }

  return null
}

export function isWebMidiSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'
}
