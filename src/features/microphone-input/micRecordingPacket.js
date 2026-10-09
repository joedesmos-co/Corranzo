/**
 * Mic recording packet (Stage 2, S2) — the musician-facing test list.
 *
 * Each packet item describes ONE short recording the user makes with the
 * dev harness. Ground truth ("played-note truth") is entered by the musician
 * and validated here — the detector NEVER generates its own truth
 * (validatePacketTruth rejects anything that is not explicit user input).
 *
 * Pure + testable: no audio APIs, no DOM. The harness UI renders
 * MIC_RECORDING_PACKET and persists per-item status + truth alongside the
 * saved WAV/JSON sidecar.
 */

export const PACKET_INSTRUMENTS = {
  PIANO: 'piano',
  ACOUSTIC_GUITAR: 'acoustic-guitar',
  ELECTRIC_GUITAR: 'electric-guitar',
  CONTROL: 'control',
}

export const PACKET_KINDS = {
  SINGLE: 'single',
  INTERVAL: 'interval',
  CHORD: 'chord',
  STRUM: 'strum',
  SILENCE: 'silence',
}

export const MIN_MIDI = 21
export const MAX_MIDI = 108

function item(id, instrument, kind, label, prompt) {
  return { id, instrument, kind, label, prompt }
}

/**
 * The full Stage-2 recording packet. Order is the recommended recording
 * order (single notes first to verify the chain, then chords).
 */
export const MIC_RECORDING_PACKET = [
  // ---- piano ----
  item('piano-c4-single', PACKET_INSTRUMENTS.PIANO, PACKET_KINDS.SINGLE,
    'Piano · C4 single note',
    'Play middle C (C4) once, medium loudness, let it ring ~2 seconds.'),
  item('piano-c-major-triad', PACKET_INSTRUMENTS.PIANO, PACKET_KINDS.CHORD,
    'Piano · C major triad',
    'Play C4 + E4 + G4 together as one block chord, hold ~2 seconds.'),
  item('piano-c-minor-triad', PACKET_INSTRUMENTS.PIANO, PACKET_KINDS.CHORD,
    'Piano · C minor triad',
    'Play C4 + Eb4 + G4 together as one block chord, hold ~2 seconds.'),
  item('piano-cmaj7', PACKET_INSTRUMENTS.PIANO, PACKET_KINDS.CHORD,
    'Piano · Cmaj7',
    'Play C4 + E4 + G4 + B4 together, hold ~2 seconds. Interior E4 is the masking test.'),
  item('piano-interval-3rd', PACKET_INSTRUMENTS.PIANO, PACKET_KINDS.INTERVAL,
    'Piano · two-note interval',
    'Play any two-note interval (e.g. C4 + G4) together, hold ~2 seconds.'),
  item('piano-inversion', PACKET_INSTRUMENTS.PIANO, PACKET_KINDS.CHORD,
    'Piano · chord inversion',
    'Play a first-inversion triad (e.g. E4 + G4 + C5) together, hold ~2 seconds.'),
  item('piano-sustained-chord', PACKET_INSTRUMENTS.PIANO, PACKET_KINDS.CHORD,
    'Piano · sustained chord (pedal ok)',
    'Play a C major triad with the sustain pedal down, hold ~4 seconds.'),
  item('piano-repeated-chord', PACKET_INSTRUMENTS.PIANO, PACKET_KINDS.CHORD,
    'Piano · repeated chord',
    'Play the same C major triad THREE times with clear gaps between attacks.'),
  // ---- acoustic guitar ----
  item('acoustic-open-string', PACKET_INSTRUMENTS.ACOUSTIC_GUITAR, PACKET_KINDS.SINGLE,
    'Acoustic · individual string',
    'Pick one open string (e.g. G3) once, let it ring ~2 seconds.'),
  item('acoustic-em-open', PACKET_INSTRUMENTS.ACOUSTIC_GUITAR, PACKET_KINDS.CHORD,
    'Acoustic · Em open chord',
    'Strum an open Em chord naturally (E2 A2 D3 G3 B3 E4), let it ring.'),
  item('acoustic-g-open', PACKET_INSTRUMENTS.ACOUSTIC_GUITAR, PACKET_KINDS.CHORD,
    'Acoustic · G open chord',
    'Strum an open G chord naturally (G2 B2 D3 G3 B3 G4), let it ring.'),
  item('acoustic-power-chord', PACKET_INSTRUMENTS.ACOUSTIC_GUITAR, PACKET_KINDS.INTERVAL,
    'Acoustic · power chord',
    'Play a two-string power chord (e.g. E2 + B2) with one pick stroke.'),
  item('acoustic-two-string-interval', PACKET_INSTRUMENTS.ACOUSTIC_GUITAR, PACKET_KINDS.INTERVAL,
    'Acoustic · two-string interval',
    'Play an adjacent-string double stop (e.g. G3 + B3) with one pick stroke.'),
  item('acoustic-fingerpicked', PACKET_INSTRUMENTS.ACOUSTIC_GUITAR, PACKET_KINDS.SINGLE,
    'Acoustic · fingerpicked notes',
    'Fingerpick three single notes in a row with small gaps (e.g. E4 G4 B4). Enter all three as truth.'),
  item('acoustic-strummed-chord', PACKET_INSTRUMENTS.ACOUSTIC_GUITAR, PACKET_KINDS.STRUM,
    'Acoustic · strummed chord',
    'Strum one full chord slowly so strings enter audibly staggered, then let it ring.'),
  // ---- electric guitar ----
  item('electric-clean-single', PACKET_INSTRUMENTS.ELECTRIC_GUITAR, PACKET_KINDS.SINGLE,
    'Electric · clean amplified single note',
    'With a CLEAN amp tone, mic near the speaker, play A3 once, let it ring ~2 seconds.'),
  item('electric-clean-power', PACKET_INSTRUMENTS.ELECTRIC_GUITAR, PACKET_KINDS.INTERVAL,
    'Electric · clean amplified power chord',
    'With a CLEAN amp tone, play E2 + B2 together, let it ring.'),
  item('electric-clean-chord', PACKET_INSTRUMENTS.ELECTRIC_GUITAR, PACKET_KINDS.CHORD,
    'Electric · clean amplified full chord',
    'With a CLEAN amp tone, play an open Em chord through the amp, let it ring.'),
  item('electric-gain-steps', PACKET_INSTRUMENTS.ELECTRIC_GUITAR, PACKET_KINDS.SINGLE,
    'Electric · gain/volume steps',
    'Play the SAME single note (A3) three times: quiet → medium → loud amp volume. Enter A3 once as truth.'),
  item('electric-di-if-available', PACKET_INSTRUMENTS.ELECTRIC_GUITAR, PACKET_KINDS.SINGLE,
    'Electric · direct interface input (optional)',
    'If an audio interface is available, select it as the input device and play A3 once.'),
  item('electric-unplugged', PACKET_INSTRUMENTS.ELECTRIC_GUITAR, PACKET_KINDS.SINGLE,
    'Electric · unplugged quiet signal (optional)',
    'Play A3 on the UNPLUGGED electric at normal picking strength. Expect a quiet-signal result — this calibrates the floor.'),
  // ---- controls ----
  item('control-silence', PACKET_INSTRUMENTS.CONTROL, PACKET_KINDS.SILENCE,
    'Control · silence',
    'Record ~3 seconds of the quiet room. Do not play anything. Truth stays empty.'),
  item('control-room-noise', PACKET_INSTRUMENTS.CONTROL, PACKET_KINDS.SILENCE,
    'Control · background noise',
    'Record ~3 seconds of normal room background (HVAC, street). Do not play. Truth stays empty.'),
]

export function getPacketItem(packetItemId) {
  return MIC_RECORDING_PACKET.find((entry) => entry.id === packetItemId) ?? null
}

/**
 * Validate user-entered played-note truth for a packet item.
 * Returns a normalized sorted array of MIDI numbers.
 * Throws when the truth did not come from the musician in valid form —
 * the detector must never fill this in.
 */
export function validatePacketTruth(packetItem, midis) {
  if (!packetItem) {
    throw new TypeError('validatePacketTruth requires a packet item')
  }
  const list = Array.isArray(midis) ? midis : []
  if (packetItem.kind === PACKET_KINDS.SILENCE) {
    if (list.length > 0) {
      throw new TypeError(`Truth for ${packetItem.id} must be empty (silence control)`)
    }
    return []
  }
  if (list.length === 0) {
    throw new TypeError(`Truth for ${packetItem.id} is missing — enter the notes you played`)
  }
  const normalized = []
  for (const value of list) {
    const midi = Number(value)
    if (!Number.isInteger(midi) || midi < MIN_MIDI || midi > MAX_MIDI) {
      throw new TypeError(`Truth for ${packetItem.id} contains invalid MIDI: ${String(value)}`)
    }
    if (!normalized.includes(midi)) {
      normalized.push(midi)
    }
  }
  normalized.sort((left, right) => left - right)
  return normalized
}

export function createRecordingSession(packetId = 'stage2-packet-v1') {
  return {
    packetId,
    startedAt: new Date().toISOString(),
    items: {},
  }
}

export function markSessionItem(session, packetItemId, { status, truthMidis = null } = {}) {
  if (!session || typeof session !== 'object') {
    throw new TypeError('markSessionItem requires a session')
  }
  const packetItem = getPacketItem(packetItemId)
  if (!packetItem) {
    throw new TypeError(`Unknown packet item: ${packetItemId}`)
  }
  const truth = truthMidis == null ? null : validatePacketTruth(packetItem, truthMidis)
  session.items[packetItemId] = {
    status,
    truth,
    updatedAt: new Date().toISOString(),
  }
  return session.items[packetItemId]
}

/**
 * Build the JSON sidecar saved next to each recording.
 * truthSource is ALWAYS 'user-entered' (or 'missing' when the musician has
 * not entered truth yet) — detector output lives under detectorFrames and
 * can never be mistaken for ground truth.
 */
export function buildRecordingSidecar({
  packetItemId,
  truthMidis = null,
  audio = {},
  detectorFrames = [],
  notes = '',
} = {}) {
  const packetItem = getPacketItem(packetItemId)
  if (!packetItem) {
    throw new TypeError(`Unknown packet item: ${packetItemId}`)
  }
  const truth = truthMidis == null ? null : validatePacketTruth(packetItem, truthMidis)
  return {
    format: 'corranzo-mic-recording-v1',
    packetItemId,
    packetLabel: packetItem.label,
    instrument: packetItem.instrument,
    kind: packetItem.kind,
    truth,
    truthSource: truth == null ? 'missing' : 'user-entered',
    audio: {
      sampleRate: audio.sampleRate ?? null,
      channels: audio.channels ?? 1,
      durationSeconds: audio.durationSeconds ?? null,
      deviceLabel: audio.deviceLabel ?? null,
      captureSettings: audio.captureSettings ?? null,
      recordedAt: audio.recordedAt ?? new Date().toISOString(),
    },
    detectorFrames,
    notes,
  }
}
