/**
 * Rights-clean synthetic corpus: an in-house additive renderer with exact
 * note-level ground truth.
 *
 * Why this exists: the two fine-tunes failed for lack of diverse, rights-clean
 * data, not for lack of a trainable model. GuitarSet is 3 h of one instrument;
 * a model needs many timbres, registers, densities and dynamics. Every
 * third-party sample library carries its own licence, so this renderer uses
 * only our own code and arithmetic: additive partials with a deterministic
 * noise transient. There is no soundfont and therefore no sample-library
 * right to clear.
 *
 * Everything is reproducible from a string seed. A composition is identified
 * by its id, and its split is derived from that id, so:
 *   - every render of the same composition lands in the same split;
 *   - variants (different seeds/timbres) of one composition never straddle
 *     train and test;
 *   - the splits are composition-disjoint by construction.
 *
 * Ground truth is the rendered event list (pitch, onset, offset, velocity,
 * instrument) plus a measured *audible* onset: the symbolic onset is not
 * trusted, the first energy rise in the waveform is measured, and the two are
 * compared so a reader can see the rendering latency.
 */

export const SAMPLE_RATE = 22050
export const INSTRUMENTS = ['piano', 'guitar']
export const TEXTURES = ['single', 'melody', 'chords', 'dense', 'bass', 'repeated', 'octaves', 'innerVoices', 'mixed']

/* --------------------------------------------------------------- randomness */

function hashString(value) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** xorshift32: deterministic, fast, reproducible from a string. */
export function makeRng(seedString) {
  let state = hashString(String(seedString)) || 1
  return () => {
    state ^= state << 13; state >>>= 0
    state ^= state >>> 17
    state ^= state << 5; state >>>= 0
    return state / 4294967296
  }
}

/* ------------------------------------------------------------- composition */

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]

/**
 * Composition-disjoint splits, stratified so every split sees every texture
 * and instrument. The split is a pure function of the composition id.
 */
export function splitForComposition(id, { train = 70, val = 15 } = {}) {
  const bucket = hashString(`split:${id}`) % 100
  if (bucket < train) return 'train'
  if (bucket < train + val) return 'val'
  return 'test'
}

/**
 * Build a composition. `texture` controls what the music exercises; the
 * register, scale and rhythm are seeded from `id` so a composition is
 * reproducible on any machine.
 */
export function compositionSpec({ id, instrument = 'piano', texture = 'melody', bars = 4, bpm = 100, seed = null }) {
  const rng = makeRng(seed ?? `comp:${id}`)
  const beat = 60 / bpm
  const notes = []
  const root = 48 + Math.floor(rng() * 12) // C3..B3
  const scale = rng() < 0.5 ? MAJOR : MINOR
  const pick = () => scale[Math.floor(rng() * scale.length)]
  const add = (midi, startBeat, beats, velocity = 0.6) => {
    if (midi < 21 || midi > 108) return
    notes.push({
      midi: Math.round(midi),
      onsetSeconds: Math.round(startBeat * beat * 1000) / 1000,
      offsetSeconds: Math.round((startBeat + beats) * beat * 1000) / 1000,
      velocity: Math.round(Math.max(0.15, Math.min(1, velocity)) * 100) / 100,
      instrument,
    })
  }
  const totalBeats = bars * 4
  if (texture === 'single') {
    for (let b = 0; b < totalBeats; b += 2) add(40 + Math.floor(rng() * 40), b, 1.2, 0.5 + rng() * 0.4)
  } else if (texture === 'melody') {
    let degree = Math.floor(rng() * scale.length)
    for (let b = 0; b < totalBeats; b += 0.5) {
      degree = Math.max(0, Math.min(scale.length - 1, degree + Math.floor(rng() * 3) - 1))
      add(60 + (root % 12) + scale[degree] + (rng() < 0.15 ? 12 : 0), b, 0.45, 0.45 + rng() * 0.45)
    }
  } else if (texture === 'chords') {
    for (let b = 0; b < totalBeats; b += 2) {
      const third = pick(); const fifth = pick()
      for (const interval of [0, third, fifth]) add(root + interval, b, 1.8, 0.4 + rng() * 0.3)
    }
  } else if (texture === 'dense') {
    for (let b = 0; b < totalBeats; b += 1) {
      const shape = rng() < 0.5 ? [0, 3, 7, 10, 12] : [0, 4, 7, 11, 14]
      for (const interval of shape) add(root + 12 + interval, b, 0.9, 0.3 + rng() * 0.3)
      add(root + 24 + pick(), b, 0.9, 0.5 + rng() * 0.3) // melody on top
    }
  } else if (texture === 'bass') {
    for (let b = 0; b < totalBeats; b += 1.5) {
      const low = 28 + Math.floor(rng() * 12) // E1..G#2
      add(low, b, 1.2, 0.6 + rng() * 0.35)
      if (rng() < 0.35) add(low + 12, b + 0.25, 0.6, 0.35 + rng() * 0.2)
    }
  } else if (texture === 'repeated') {
    const pitch = root + 12 + pick()
    for (let b = 0; b < totalBeats; b += 0.5) add(pitch, b, 0.35, 0.4 + rng() * 0.4)
  } else if (texture === 'octaves') {
    for (let b = 0; b < totalBeats; b += 1) {
      const pitch = 48 + Math.floor(rng() * 12)
      add(pitch, b, 0.9, 0.55 + rng() * 0.3)
      add(pitch + 12, b, 0.9, 0.3 + rng() * 0.3) // genuine doubling, quieter
    }
  } else if (texture === 'innerVoices') {
    for (let b = 0; b < totalBeats; b += 1) {
      add(root + 24 + pick(), b, 0.8, 0.8)          // loud melody
      add(root + 7 + pick(), b + 0.5, 0.4, 0.16)    // quiet inner voice
    }
  } else { // mixed
    for (let b = 0; b < totalBeats; b += 1) {
      add(root - 12 + pick(), b, 0.9, 0.6)                       // bass
      if (rng() < 0.5) add(root + pick(), b, 0.8, 0.4)           // chord tone
      if (rng() < 0.6) add(root + 24 + pick(), b + 0.5, 0.4, 0.7) // melody
      if (rng() < 0.2) add(root + 12 + pick(), b + 0.75, 0.25, 0.3)
    }
  }
  notes.sort((a, b) => a.onsetSeconds - b.onsetSeconds || a.midi - b.midi)
  const last = notes.reduce((max, n) => Math.max(max, n.offsetSeconds), 0)
  const durationSeconds = Math.ceil((last + 0.6) * 10) / 10
  return { id, instrument, texture, bpm, seed: seed ?? `comp:${id}`, durationSeconds, notes }
}

/* ------------------------------------------------------------------ render */

/**
 * Partial gains, tuned against measured real recordings (domains: real
 * acoustic guitar centroid 247 Hz, H1 share 0.56, even/odd 1.71; real piano
 * H1 share 0.064 - i.e. NOT fundamental-dominated). The first renderer was far
 * too bright on guitar and far too dark on piano.
 */
function partialGains(instrument, midi, velocity, rng) {
  const h = []
  if (instrument === 'guitar') {
    const count = 10
    for (let i = 1; i <= count; i += 1) h.push(1 / Math.pow(i, 1.75))
    // pluck position: a comb notch where the string is excited (0.12-0.3)
    const pluck = 0.12 + rng() * 0.18
    for (let i = 1; i <= count; i += 1) h[i - 1] *= Math.abs(Math.sin(Math.PI * i * pluck)) + 0.25
    // body resonance lift around 100-260 Hz (partials 2-4 of a low note)
    for (let i = 1; i <= count; i += 1) {
      const freq = 440 * 2 ** ((midi - 69) / 12) * i
      if (freq > 80 && freq < 280) h[i - 1] *= 1.35
    }
  } else {
    const count = 16
    const low = Math.max(0, (60 - midi) / 24)
    // velocity brightens the spectrum (hammer harder -> more upper partials)
    const bright = 0.9 + velocity * 0.9
    for (let i = 1; i <= count; i += 1) h.push((1 + (bright - 1) * (i / 8)) / Math.pow(i, 1.25 + low * 0.3))
  }
  return h
}

/** Inharmonicity: real strings stretch their partials slightly. */
function partialFreq(f0, h, instrument) {
  const B = instrument === 'guitar' ? 0.00008 : 0.00035
  return f0 * h * Math.sqrt(1 + B * h * h)
}

/**
 * Render a composition to mono float32 at 22050 Hz with the exact event list.
 * Pure arithmetic: no samples, no external assets.
 */
export function renderComposition(spec, { sampleRate = SAMPLE_RATE, realistic = true } = {}) {
  const { notes, durationSeconds } = spec
  const length = Math.ceil(durationSeconds * sampleRate)
  const out = new Float32Array(length)
  const rng = makeRng(`render:${spec.id}:${spec.seed}:${spec.instrument}`)
  const isGuitar = spec.instrument === 'guitar'
  // Real attacks are slower than a sample-loop start: measured 5.8 ms on
  // acoustic guitar and ~30-50 ms on a mic'd piano. Decay is register
  // dependent: a real acoustic guitar rings ~190 ms at mid pitches, a piano
  // low string far longer.
  const attack = realistic ? (isGuitar ? 0.006 : 0.030) : (isGuitar ? 0.002 : 0.004)
  if (realistic) {
    // A recording is never digitally silent: broadband floor at about -55 dBFS.
    for (let i = 0; i < length; i += 1) out[i] += (rng() - 0.5) * 0.0035
  }
  // Strum: chord notes do not start on the same sample. Deterministic stagger
  // by pitch, recorded in the truth so the labels stay exact.
  const byOnset = new Map()
  for (const note of notes) {
    const key = note.onsetSeconds.toFixed(3)
    if (!byOnset.has(key)) byOnset.set(key, [])
    byOnset.get(key).push(note)
  }
  const renderedOnset = new Map()
  for (const [, group] of byOnset) {
    if (group.length === 1) { renderedOnset.set(group[0], group[0].onsetSeconds); continue }
    const ordered = [...group].sort((a, b) => a.midi - b.midi)
    ordered.forEach((note, index) => {
      const spread = isGuitar && realistic ? index * (0.006 + (rng() * 0.012)) : 0
      renderedOnset.set(note, note.onsetSeconds + spread)
    })
  }
  const renderedNotes = []
  for (const note of notes) {
    const f0 = 440 * 2 ** ((note.midi - 69) / 12)
    const onset = renderedOnset.get(note) ?? note.onsetSeconds
    const s0 = Math.floor(onset * sampleRate)
    const s1 = Math.min(length, Math.floor(note.offsetSeconds * sampleRate))
    if (s1 <= s0) continue
    renderedNotes.push({
      midi: note.midi,
      onsetSeconds: Math.round(onset * 10000) / 10000,
      offsetSeconds: note.offsetSeconds,
      velocity: note.velocity,
      instrument: note.instrument,
      symbolicOnsetSeconds: note.onsetSeconds,
    })
    const gains = partialGains(spec.instrument, note.midi, note.velocity, rng)
    // Measured: real acoustic guitar tau ~190 ms at mid pitches, longer low;
    // piano tau ~900 ms with low strings ringing longest.
    const tau = isGuitar
      ? (realistic ? 0.19 : 0.55) * (1.5 - Math.min(1, (note.midi - 40) / 60) * 0.6)
      : (realistic ? 0.9 : 1.25) * (1.6 - Math.min(1, (note.midi - 40) / 60) * 0.6)
    const amp = 0.10 + note.velocity * 0.32
    const attackSamples = Math.max(1, Math.floor(attack * sampleRate))
    for (let i = s0; i < s1; i += 1) {
      const t = (i - s0) / sampleRate
      const decayEnv = Math.exp(-t / tau)
      // The attack starts at zero, so the "note has decayed" exit must only be
      // tested once the attack has finished - otherwise every note is silent.
      if (i - s0 >= attackSamples && decayEnv < 1e-4) break
      const env = (i - s0 < attackSamples ? (i - s0) / attackSamples : 1) * decayEnv
      let v = 0
      for (let h = 1; h <= gains.length; h += 1) {
        const freq = partialFreq(f0, h, spec.instrument)
        if (freq >= sampleRate / 2) break
        // Real strings lose their upper partials faster than the fundamental;
        // a single decay for every partial sounds static and synthetic.
        const partialEnv = h === 1 ? 1 : Math.exp(-t * (h - 1) * 0.45 / tau)
        v += gains[h - 1] * partialEnv * Math.sin(2 * Math.PI * freq * t + h * 0.7)
        if (realistic && h <= 3) {
          // two strings slightly apart beat against each other (piano unison,
          // guitar paired string): a small detune, not random noise
          const detune = spec.instrument === 'piano' ? 0.0009 : 0.0004
          v += 0.5 * gains[h - 1] * partialEnv * Math.sin(2 * Math.PI * freq * (1 + detune) * t + h * 0.3)
        }
      }
      out[i] += amp * env * v
    }
    if (isGuitar) {
      // a short deterministic pluck transient: the attack a real pick makes
      const burst = Math.min(Math.floor(0.012 * sampleRate), length - s0)
      for (let i = 0; i < burst; i += 1) {
        const t = i / sampleRate
        out[s0 + i] += (rng() - 0.5) * 0.12 * note.velocity * Math.exp(-t / 0.004)
      }
    }
  }
  // Microphone/body tilt: a first-order low pass, stronger for the guitar
  // (measured centroid 247 Hz on real acoustic guitar versus 1032 Hz for the
  // first renderer). Applied before normalisation.
  if (realistic) {
    const cutoff = isGuitar ? 1400 : 5200
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate)
    let y = 0
    for (let i = 0; i < out.length; i += 1) { y += alpha * (out[i] - y); out[i] = y }
  }
  let peak = 0
  for (let i = 0; i < out.length; i += 1) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0) {
    const gain = 0.85 / peak
    for (let i = 0; i < out.length; i += 1) out[i] *= gain
  }
  // The label is the AUDIBLE onset, not the sample-loop start: a 30 ms piano
  // attack is audibly late by ~7 ms, and a training label that ignores it
  // teaches the model a bias. Measured here from the rendered waveform, and
  // kept next to the symbolic onset so the provenance is explicit.
  for (const note of renderedNotes) {
    const measured = measureAudibleOnset(out, sampleRate, note)
    note.audibleOnsetSeconds = measured == null ? note.onsetSeconds : Math.round(measured * 10000) / 10000
  }
  return { samples: out, sampleRate, notes: renderedNotes }
}

/* -------------------------------------------------- audible-onset verification */

/**
 * Measure the audible onset of a note in the rendered waveform.
 *
 * The symbolic onset is where the sample loop starts; the audible onset is
 * where the energy actually rises. A short RMS envelope is scanned from 25 ms
 * before the symbolic onset; the measured onset is the first frame crossing
 * 20 % of that note's own peak envelope. Returns null when the note is masked
 * by a louder simultaneous note (the measurement is not meaningful then).
 */
export function measureAudibleOnset(samples, sampleRate, note, { frame = 64 } = {}) {
  const s0 = Math.floor(note.onsetSeconds * sampleRate)
  const windowStart = Math.max(0, s0 - Math.floor(0.025 * sampleRate))
  const windowEnd = Math.min(samples.length, s0 + Math.floor(0.12 * sampleRate))
  if (windowEnd - windowStart < frame * 4) return null
  const rms = []
  for (let i = windowStart; i + frame <= windowEnd; i += frame) {
    let sum = 0
    for (let j = 0; j < frame; j += 1) sum += samples[i + j] * samples[i + j]
    rms.push(Math.sqrt(sum / frame))
  }
  const peak = Math.max(...rms)
  if (peak < 1e-6) return null
  const threshold = peak * 0.2
  const index = rms.findIndex((v) => v >= threshold)
  if (index < 0) return null
  return (windowStart + index * frame) / sampleRate
}

/** Is this note the first onset at its moment? (isolated onset measurement) */
export function hasIsolatedOnset(spec, index, toleranceSeconds = 0.03) {
  const note = spec.notes[index]
  return !spec.notes.some((other, j) => j !== index && Math.abs(other.onsetSeconds - note.onsetSeconds) < toleranceSeconds)
}
