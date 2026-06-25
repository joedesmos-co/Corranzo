/**
 * Pure, browser-free MIDI session logic: device selection, reconnect, and the
 * live activity model (active notes, sustain, counts, latency). Kept separate
 * from the React hook so all of it is unit-testable.
 */

export const SUSTAIN_CC = 64
const LAST_DEVICE_KEY = 'corranzo.midi.lastDeviceName'

/** Normalize a Web MIDI input into our lightweight device descriptor. */
export function describeDevice(input) {
  if (!input) return null
  return {
    id: input.id,
    name: input.name || 'MIDI input',
    manufacturer: input.manufacturer || '',
  }
}

/**
 * Choose which connected device should be active.
 *   1. an explicit current selection that is still connected;
 *   2. otherwise the last-used device (matched by name, since ids can change on
 *      replug) — this is the auto-reconnect path;
 *   3. otherwise the first available device (so a single keyboard just works).
 */
export function pickActiveDevice(devices, selectedId, rememberedName) {
  if (!devices?.length) return null
  if (selectedId) {
    const byId = devices.find((d) => d.id === selectedId)
    if (byId) return byId
  }
  if (rememberedName) {
    const byName = devices.find((d) => d.name === rememberedName)
    if (byName) return byName
  }
  return devices[0]
}

/** Human-readable connection status, e.g. "Connected: Roland FP-30X". */
export function deviceStatusLabel({ supported, granted, activeDevice }) {
  if (!supported) return 'MIDI not supported in this browser'
  if (!granted) return 'MIDI off'
  if (!activeDevice) return 'No MIDI device connected.'
  return `Connected: ${activeDevice.name}`
}

export function createMidiActivity() {
  return {
    active: new Map(), // midi -> velocity
    sustain: false,
    noteCount: 0,
    lastNote: null,
  }
}

/**
 * Fold a parsed MIDI message into the activity model. Mutates `activity` (it is a
 * per-session ref, not React state) and returns the parsed event so the caller
 * can forward note-ons to listeners. Velocity is preserved on the event and in
 * the active-notes map (never flattened).
 */
export function applyParsedMessage(activity, parsed, at = 0) {
  if (!parsed) return null
  if (parsed.type === 'noteon') {
    activity.active.set(parsed.midi, parsed.velocity)
    activity.noteCount += 1
    activity.lastNote = { midi: parsed.midi, velocity: parsed.velocity, at }
    return parsed
  }
  if (parsed.type === 'noteoff') {
    activity.active.delete(parsed.midi)
    return parsed
  }
  if (parsed.type === 'sustain') {
    activity.sustain = parsed.on
    return parsed
  }
  return parsed
}

/** Sorted list of currently held (note-on, not yet note-off) MIDI numbers. */
export function activeNoteList(activity) {
  return [...activity.active.keys()].sort((a, b) => a - b)
}

/**
 * Rolling latency estimate (ms) from the MIDI event timestamp to JS receipt.
 * Web MIDI event.timeStamp is performance.now()-based; a negative/garbage delta
 * (some drivers report 0) is ignored.
 */
export function updateLatencyEstimate(prev, eventTimeStamp, receiveTime) {
  if (!Number.isFinite(eventTimeStamp) || eventTimeStamp <= 0) return prev
  const sample = receiveTime - eventTimeStamp
  if (!Number.isFinite(sample) || sample < 0 || sample > 1000) return prev
  if (prev == null) return sample
  return prev * 0.8 + sample * 0.2
}

export function loadLastMidiDeviceName() {
  try {
    return globalThis.localStorage?.getItem(LAST_DEVICE_KEY) ?? null
  } catch {
    return null
  }
}

export function saveLastMidiDeviceName(name) {
  try {
    if (name) globalThis.localStorage?.setItem(LAST_DEVICE_KEY, name)
  } catch {
    // ignore storage errors (private mode, SSR)
  }
}
