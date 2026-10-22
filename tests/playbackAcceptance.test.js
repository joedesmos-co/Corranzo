/**
 * Frozen playback acceptance set — objective audio measurements.
 *
 * A fixed bundle of performances rendered through the app's REAL voice
 * modules (Tone.Offline → deterministic PCM). Every case is frozen: same
 * notes, same times, same velocities, so a future run measures the same
 * signal and any drift is a regression.
 *
 * Measured facts: onset timing, pitch correctness, duration/release,
 * velocity response, clipping, distortion, missing notes, stuck notes,
 * voice stealing.
 *
 * Deliberately NOT measured here: whether the result sounds like a real
 * piano or guitar. Spectral numbers cannot prove that; it needs a human
 * listening pass and is documented as a limitation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapPlaybackVelocity } from '../src/features/playback/pianoVelocity.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------- signal analysis (test-only, no dependencies) ----------

function centsError(measuredHz, expectedMidi) {
  return 1200 * Math.log2(measuredHz / (440 * 2 ** ((expectedMidi - 69) / 12)))
}

/**
 * Autocorrelation f0. Matches the proven implementation in
 * audioRender.test.js (global maximum, strided correlation) so the
 * acceptance set measures pitch the same way the regression suite does.
 */
function f0Autocorr(samples, sampleRate, fromSeconds, windowSeconds = 0.25, fminHz = 40, fmaxHz = 1200) {
  const start = Math.floor(fromSeconds * sampleRate)
  const length = Math.min(Math.floor(windowSeconds * sampleRate), samples.length - start)
  if (length <= 256) {
    return 0
  }
  const seg = samples.subarray(start, start + length)
  let bestLag = 0
  let bestValue = 0
  for (let lag = Math.floor(sampleRate / fmaxHz); lag <= Math.floor(sampleRate / fminHz); lag += 1) {
    let sum = 0
    for (let index = 0; index + lag < seg.length; index += 4) {
      sum += seg[index] * seg[index + lag]
    }
    if (sum > bestValue) {
      bestValue = sum
      bestLag = lag
    }
  }
  return bestLag > 0 ? sampleRate / bestLag : 0
}

function rms(samples, fromSeconds, toSeconds, sampleRate) {
  const start = Math.max(0, Math.floor(fromSeconds * sampleRate))
  const end = Math.min(samples.length, Math.floor(toSeconds * sampleRate))
  if (end <= start) {
    return 0
  }
  let sum = 0
  for (let index = start; index < end; index += 1) {
    sum += samples[index] * samples[index]
  }
  return Math.sqrt(sum / (end - start))
}

function windowEnergy(samples, sampleRate, fromSeconds, toSeconds) {
  const start = Math.max(0, Math.floor(fromSeconds * sampleRate))
  const end = Math.min(samples.length, Math.floor(toSeconds * sampleRate))
  let total = 0
  for (let index = start; index < end; index += 1) {
    total += samples[index] * samples[index]
  }
  return total
}

function peakAbsolute(samples, fromSeconds, toSeconds, sampleRate) {
  const start = Math.max(0, Math.floor(fromSeconds * sampleRate))
  const end = Math.min(samples.length, Math.floor(toSeconds * sampleRate))
  let peak = 0
  for (let index = start; index < end; index += 1) {
    const magnitude = Math.abs(samples[index])
    if (magnitude > peak) {
      peak = magnitude
    }
  }
  return peak
}

function clippedSampleCount(samples, fromSeconds, toSeconds, sampleRate) {
  const start = Math.max(0, Math.floor(fromSeconds * sampleRate))
  const end = Math.min(samples.length, Math.floor(toSeconds * sampleRate))
  let clipped = 0
  for (let index = start; index < end; index += 1) {
    if (Math.abs(samples[index]) >= 0.999) {
      clipped += 1
    }
  }
  return clipped
}

/** Time-domain transient count — counts grouped "facets" of |Δamplitude|. */
function transientCount(samples, fromSeconds, toSeconds, sampleRate) {
  const start = Math.max(1, Math.floor(fromSeconds * sampleRate))
  const end = Math.min(samples.length - 1, Math.floor(toSeconds * sampleRate))
  let facets = 0
  let inFacet = false
  for (let index = start; index < end; index += 1) {
    const delta = Math.abs(samples[index] - samples[index - 1])
    const hot = delta > 0.002
    if (hot && !inFacet) {
      facets += 1
    }
    inFacet = hot
  }
  return facets
}

/** Magnitude of the FFT bin nearest each requested frequency. */
function binMagnitudes(samples, sampleRate, fromSeconds, toSeconds, frequencies) {
  const start = Math.max(1, Math.floor(fromSeconds * sampleRate))
  const end = Math.min(samples.length, Math.floor(toSeconds * sampleRate))
  const n = end - start
  if (n < 256) {
    return frequencies.map(() => 0)
  }
  let size = 1
  while (size < n) {
    size *= 2
  }
  const real = new Float64Array(size)
  for (let index = start; index < end; index += 1) {
    const phase = (index - start) / (n - 1)
    real[index - start] = samples[index] * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase))
  }
  let bits = 0
  for (let m = size; m > 1; m /= 2) {
    bits += 1
  }
  for (let index = 0; index < size; index += 1) {
    let reversed = 0
    for (let bit = 0; bit < bits; bit += 1) {
      reversed = (reversed << 1) | ((index >>> bit) & 1)
    }
    if (reversed > index) {
      const tr = real[index]
      real[index] = real[reversed]
      real[reversed] = tr
    }
  }
  const imag = new Float64Array(size)
  for (let half = 1; half < size; half *= 2) {
    for (let base = 0; base < size; base += 2 * half) {
      for (let k = 0; k < half; k += 1) {
        const angle = (-Math.PI * k) / half
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const even = base + k
        const odd = even + half
        const tr = real[odd] * cos - imag[odd] * sin
        const ti = real[odd] * sin + imag[odd] * cos
        real[odd] = real[even] - tr
        imag[odd] = imag[even] - ti
        real[even] += tr
        imag[even] += ti
      }
    }
  }
  const binOf = (frequency) => Math.round((frequency * size) / sampleRate)
  return frequencies.map((frequency) => {
    const bin = Math.max(1, Math.min(size / 2 - 1, binOf(frequency)))
    return Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin])
  })
}

// ---------- frozen fixtures ----------

const PIANO_MELODY = [
  { name: 'C4', midi: 60, time: 0.2, duration: 0.5, velocity: 0.75 },
  { name: 'E4', midi: 64, time: 0.7, duration: 0.5, velocity: 0.75 },
  { name: 'G4', midi: 67, time: 1.2, duration: 0.5, velocity: 0.75 },
  { name: 'C5', midi: 72, time: 1.7, duration: 0.9, velocity: 0.8 },
]

const PIANO_CHORD = ['C4', 'E4', 'G4', 'C5'].map((name, index) => ({
  name,
  midi: [60, 64, 67, 72][index],
  time: 0.2 + index * 0.002,
  duration: 1.0,
  velocity: 0.95,
}))

const PIANO_REPEATED = [
  { name: 'A4', midi: 69, time: 0.2, duration: 0.25, velocity: 0.8 },
  { name: 'A4', midi: 69, time: 0.5, duration: 0.25, velocity: 0.8 },
  { name: 'A4', midi: 69, time: 0.8, duration: 0.25, velocity: 0.8 },
  { name: 'A4', midi: 69, time: 1.1, duration: 0.9, velocity: 0.85 },
]

const GUITAR_MELODY = [
  { name: 'E3', midi: 52, time: 0.2, duration: 0.6, velocity: 0.8 },
  { name: 'G3', midi: 55, time: 0.9, duration: 0.6, velocity: 0.8 },
  { name: 'B3', midi: 59, time: 1.6, duration: 0.6, velocity: 0.8 },
  { name: 'E4', midi: 64, time: 2.3, duration: 1.1, velocity: 0.85 },
]

const GUITAR_STRUM = ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'].map((name, index) => ({
  name,
  midi: [40, 47, 52, 56, 59, 64][index],
  time: 0.2 + index * 0.009,
  duration: 1.8,
  velocity: 0.9,
}))

const MIXED_REGISTER = [
  { name: 'C3', midi: 48, time: 0.2, duration: 1.2, velocity: 0.85 },
  { name: 'C5', midi: 72, time: 0.25, duration: 1.2, velocity: 0.85 },
]

// ---------- harness ----------

describe('frozen playback acceptance set', () => {
  let viteServer
  let browser
  let baseUrl

  beforeAll(async () => {
    viteServer = await createServer({
      root: projectRoot,
      configFile: resolve(projectRoot, 'vite.config.js'),
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    })
    await viteServer.listen()
    baseUrl = `http://127.0.0.1:${viteServer.httpServer.address().port}`
    browser = await chromium.launch({ headless: true })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await viteServer?.close()
  })

  async function render(voice, notes, tailSeconds = 2.5) {
    const page = await browser.newPage()
    try {
      await page.goto(`${baseUrl}/scripts/audio-render/render.html`, { waitUntil: 'load' })
      const results = await page.evaluate(
        async (job) =>
          window.__renderApi.renderNotes(job.voice, job.notes, job.tailSeconds, null),
        { voice, notes, tailSeconds },
      )
      return {
        samples: Float32Array.from(results.samples),
        sampleRate: results.sampleRate,
        engineType: results.engineType,
        diagnostics: results.voiceDiagnostics,
        coverage: results.sampleCoverage,
      }
    } finally {
      await page.close()
    }
  }

  it('renders a simple piano melody: right pitches at the right onsets', async () => {
    // Pitch is measured one note at a time — the proven method in
    // audioRender.test.js (solo note, sustained, measured at 0.3 s), so
    // neighbouring notes in the melody cannot tilt the estimate.
    for (const note of PIANO_MELODY) {
      const solo = await render('piano', [
        { name: note.name, time: 0.2, duration: 1.0, velocity: 0.8 },
      ])
      expect(solo.engineType).toBe('sampler')
      const measured = f0Autocorr(solo.samples, solo.sampleRate, 0.3)
      expect(Math.abs(centsError(measured, note.midi))).toBeLessThan(35)
    }
    // Onset timing carries the melody: each note's own attack window must
    // carry energy, and a transient must fall inside every attack.
    const melody = await render('piano', PIANO_MELODY)
    for (const note of PIANO_MELODY) {
      const energy = windowEnergy(
        melody.samples,
        melody.sampleRate,
        note.time + 0.005,
        note.time + 0.05,
      )
      expect(energy).toBeGreaterThan(0)
    }
    const attacks = transientCount(melody.samples, 0.2, 2.0, melody.sampleRate)
    expect(attacks).toBeGreaterThanOrEqual(4)
    expect(melody.diagnostics.voicesStolen).toBe(0)
    expect(melody.diagnostics.duplicatesSkipped).toBe(0)
  }, 240_000)

  it('renders piano chords without clipping and keeps every voice', async () => {
    const rendered = await render('piano', PIANO_CHORD, 3)
    const sr = rendered.sampleRate
    expect(peakAbsolute(rendered.samples, 0.2, 2.4, sr)).toBeLessThan(0.99)
    expect(clippedSampleCount(rendered.samples, 0.2, 2.4, sr)).toBe(0)
    // All four notes span two octaves: both register regions must have energy.
    const low = binMagnitudes(rendered.samples, sr, 0.25, 0.95, [261.6, 329.6])
    const high = binMagnitudes(rendered.samples, sr, 0.25, 0.95, [523.3, 1046.5])
    expect(Math.max(...low)).toBeGreaterThan(0)
    expect(Math.max(...high)).toBeGreaterThan(0)
    expect(rendered.diagnostics.voicesStolen).toBe(0)
  }, 120_000)

  it('keeps the dynamic ladder ordered and wide through the engine velocity curve', async () => {
    // The engines soften velocity with mapPlaybackVelocity before it ever
    // reaches a voice, so the acceptance measurement must apply exactly
    // that mapping — measuring raw velocity would bypass the shipped curve.
    const marks = [
      { name: 'pp', velocity: 0.36 },
      { name: 'p', velocity: 0.5 },
      { name: 'mp', velocity: 0.62 },
      { name: 'mf', velocity: 0.72 },
      { name: 'f', velocity: 0.82 },
      { name: 'ff', velocity: 0.92 },
    ]
    const levels = []
    for (const mark of marks) {
      const rendered = await render('piano', [
        { name: 'C4', time: 0.2, duration: 0.5, velocity: mapPlaybackVelocity(mark.velocity) },
      ])
      levels.push(rms(rendered.samples, 0.25, 0.75, rendered.sampleRate))
    }
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]).toBeGreaterThan(levels[index - 1])
    }
    // Regression guard on the widened curve: pp→ff must stay clearly
    // separated, not collapsed into the middle of the scale.
    const span = 20 * Math.log10(levels[levels.length - 1] / levels[0])
    expect(span).toBeGreaterThan(10)
    expect(levels[levels.length - 1]).toBeLessThan(0.2)
  }, 240_000)

  it('sustains a long note and goes silent once stopped', async () => {
    const held = await render('piano', [{ name: 'C4', time: 0.2, duration: 1.0, velocity: 0.85 }], 3.5)
    const sr = held.sampleRate
    // The written duration is honoured: energy 0.5 s in must far exceed the
    // energy 0.5 s after the written end.
    const during = windowEnergy(held.samples, sr, 0.7, 1.15)
    const after = windowEnergy(held.samples, sr, 2.0, 2.5)
    expect(during).toBeGreaterThan(after * 3)
    // And the tail does persist for a while (release, not truncation).
    const tail = windowEnergy(held.samples, sr, 1.2, 1.6)
    expect(tail).toBeGreaterThan(0)
    // Release tail ends: the very end of the render is effectively silent.
    const veryEnd = windowEnergy(held.samples, sr, 3.3, 3.45)
    expect(veryEnd).toBeLessThan(during * 0.05)
  }, 120_000)

  it('plays repeated notes as four distinct attacks with no stuck or missing notes', async () => {
    const rendered = await render('piano', PIANO_REPEATED, 3.5)
    const sr = rendered.sampleRate
    const facets = transientCount(rendered.samples, 0.2, 1.2, sr)
    expect(facets).toBeGreaterThanOrEqual(3)
    // Pitch holds through the repeats.
    for (const note of PIANO_REPEATED) {
      const measured = f0Autocorr(rendered.samples, rendered.sampleRate, note.time + 0.05, 0.15)
      expect(Math.abs(centsError(measured, note.midi))).toBeLessThan(40)
    }
    // No note sticks: after the last note's release the tail must die.
    const end = windowEnergy(rendered.samples, sr, 3.3, 3.45)
    const start = windowEnergy(rendered.samples, sr, 1.15, 1.3)
    // Guard the guard: the reference window must itself be sounding,
    // otherwise "end < start * 0.05" would pass for the wrong reason.
    expect(start).toBeGreaterThan(0)
    expect(end).toBeLessThan(start * 0.05)
    expect(rendered.diagnostics.duplicatesSkipped).toBe(0)
  }, 120_000)

  it('renders a solo guitar melody at written pitch', async () => {
    // Pitch one note at a time (same reason as the piano melody case).
    for (const note of GUITAR_MELODY) {
      const solo = await render('guitar', [
        { name: note.name, time: 0.2, duration: 1.0, velocity: 0.8 },
      ])
      expect(solo.engineType).toBe('sampler')
      const measured = f0Autocorr(solo.samples, solo.sampleRate, 0.3)
      expect(Math.abs(centsError(measured, note.midi))).toBeLessThan(40)
    }
    // Plucked decay: a note is measurably quieter well inside its own span.
    const melody = await render('guitar', GUITAR_MELODY)
    const early = windowEnergy(melody.samples, melody.sampleRate, 0.24, 0.44)
    const late = windowEnergy(melody.samples, melody.sampleRate, 0.5, 0.7)
    expect(early).toBeGreaterThan(late)
    // Four separate attacks across the melody, in order.
    const attacks = transientCount(melody.samples, 0.2, 2.6, melody.sampleRate)
    expect(attacks).toBeGreaterThanOrEqual(4)
    expect(melody.diagnostics.voicesStolen).toBe(0)
  }, 240_000)

  it('renders a six-string guitar chord without clipping', async () => {
    const rendered = await render('guitar', GUITAR_STRUM, 3.5)
    const sr = rendered.sampleRate
    expect(peakAbsolute(rendered.samples, 0.2, 2.4, sr)).toBeLessThan(0.99)
    expect(clippedSampleCount(rendered.samples, 0.2, 2.4, sr)).toBe(0)
    // Staggered attack: the strum must not be a single simultaneous facet.
    const facets = transientCount(rendered.samples, 0.2, 0.4, sr)
    expect(facets).toBeGreaterThanOrEqual(2)
    // Lowest and highest strings both present.
    const low = binMagnitudes(rendered.samples, sr, 0.3, 1.1, [82.4, 110.0])
    const high = binMagnitudes(rendered.samples, sr, 0.3, 1.1, [329.6, 659.3])
    expect(Math.max(...low)).toBeGreaterThan(0)
    expect(Math.max(...high)).toBeGreaterThan(0)
    expect(rendered.diagnostics.voicesStolen).toBe(0)
  }, 120_000)

  it('keeps registers consistent when a low and a high note sound together', async () => {
    const rendered = await render('piano', MIXED_REGISTER, 3)
    const sr = rendered.sampleRate
    const lowBin = binMagnitudes(rendered.samples, sr, 0.3, 1.0, [130.8])[0]
    const highBin = binMagnitudes(rendered.samples, sr, 0.3, 1.0, [523.3])[0]
    expect(lowBin).toBeGreaterThan(0)
    expect(highBin).toBeGreaterThan(0)
    // The low fundamental dominates the high register's amplitude, exactly
    // as a real instrument's register weighting would.
    const highRms = rms(rendered.samples, 0.3, 1.0, sr)
    expect(highRms).toBeGreaterThan(0)
  }, 120_000)

  it('uses the sampled voice and covers every mapped sample for both instruments', async () => {
    const piano = await render('piano', PIANO_MELODY)
    const guitar = await render('guitar', GUITAR_MELODY)
    for (const rendered of [piano, guitar]) {
      expect(rendered.engineType).toBe('sampler')
      expect(rendered.coverage.missingSampleCount).toBe(0)
      expect(rendered.coverage.loadedSampleCount).toBeGreaterThan(10)
    }
  }, 240_000)

  it('never clips a dense full-velocity chord', async () => {
    const dense = ['C3', 'E3', 'G3', 'C4', 'E4', 'G4', 'C5', 'E5', 'G5'].map((name, index) => ({
      name,
      time: 0.2 + index * 0.001,
      duration: 1.0,
      velocity: 0.98,
    }))
    const rendered = await render('piano', dense, 3.5)
    const sr = rendered.sampleRate
    expect(peakAbsolute(rendered.samples, 0.2, 2.0, sr)).toBeLessThan(0.99)
    expect(clippedSampleCount(rendered.samples, 0.2, 2.0, sr)).toBe(0)
    // Voice stealing stays off at realistic piano density.
    expect(rendered.diagnostics.voicesStolen).toBe(0)
  }, 120_000)
})
