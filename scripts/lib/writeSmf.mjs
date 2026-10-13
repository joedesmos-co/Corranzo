/**
 * Minimal, dependency-free Standard MIDI File writer (format 0, single track).
 *
 * Exists so review sets can ship PLAYABLE previews next to MusicXML without
 * adding an audio engine or a dependency. Validated by round-tripping through
 * the app's own parseMidiFile (tests/audioVisionSmfPreview.test.js).
 */

const TICKS_PER_QUARTER = 480

function writeVariableLength(value) {
  const bytes = [value & 0x7f]
  let rest = Math.floor(value / 128)
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80)
    rest = Math.floor(rest / 128)
  }
  return bytes
}

/**
 * events: [{ timeSeconds, midi, durationSeconds, velocity? }]
 * Returns a Buffer containing a valid format-0 SMF.
 */
export function writeSmf(events, { tempoBpm = 120, ticksPerQuarter = TICKS_PER_QUARTER } = {}) {
  const sorted = [...(events ?? [])].sort((a, b) => a.timeSeconds - b.timeSeconds)
  const tempoMpq = Math.round(60000000 / Math.max(1, tempoBpm))
  const words = []
  // Tempo meta event at t=0.
  words.push({ tick: 0, bytes: [0xff, 0x51, 0x03, (tempoMpq >> 16) & 0xff, (tempoMpq >> 8) & 0xff, tempoMpq & 0xff] })
  const raw = []
  for (const event of sorted) {
    const startSeconds = Math.max(0, event.timeSeconds)
    const durationSeconds = Math.max(0.05, event.durationSeconds)
    raw.push({ tick: secondsToTicks(startSeconds, tempoMpq, ticksPerQuarter), status: 0x90, midi: clampMidi(event.midi), velocity: clampVelocity(event.velocity ?? 72) })
    raw.push({ tick: secondsToTicks(startSeconds + durationSeconds, tempoMpq, ticksPerQuarter), status: 0x80, midi: clampMidi(event.midi), velocity: 0 })
  }
  raw.sort((a, b) => a.tick - b.tick || a.status - b.status)
  let previous = 0
  const trackBytes = []
  for (const word of words) {
    trackBytes.push(...writeVariableLength(word.tick - previous))
    trackBytes.push(...word.bytes)
    previous = word.tick
  }
  for (const note of raw) {
    trackBytes.push(...writeVariableLength(Math.max(0, note.tick - previous)))
    trackBytes.push(note.status, note.midi & 0x7f, note.velocity & 0x7f)
    previous = note.tick
  }
  // End of track.
  trackBytes.push(...writeVariableLength(0), 0xff, 0x2f, 0x00)

  const trackLength = trackBytes.length
  const header = [
    0x4d, 0x54, 0x68, 0x64, // MThd
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00, // format 0
    0x00, 0x01, // one track
    (ticksPerQuarter >> 8) & 0xff, ticksPerQuarter & 0xff,
  ]
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b, // MTrk
    (trackLength >> 24) & 0xff, (trackLength >> 16) & 0xff, (trackLength >> 8) & 0xff, trackLength & 0xff,
  ]
  return Buffer.from([...header, ...trackHeader, ...trackBytes])
}

function secondsToTicks(seconds, tempoMpq, ticksPerQuarter) {
  return Math.round((seconds * 1e6 * ticksPerQuarter) / tempoMpq)
}

function clampMidi(midi) {
  return Math.max(0, Math.min(127, Math.round(midi)))
}

/** 0..1 velocities (MusicXML parser) or 1..127 both map to an audible 1..127. */
function clampVelocity(velocity) {
  const value = Number.isFinite(velocity) ? velocity : 64
  const scaled = value <= 1 ? value * 127 : value
  return Math.max(1, Math.min(127, Math.round(scaled)))
}

export { TICKS_PER_QUARTER }
