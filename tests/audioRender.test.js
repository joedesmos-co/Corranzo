/**
 * Rendered-audio validation (Stage S8) — REAL audio, no mocks.
 *
 * Each case renders actual sound through the app's voice modules in
 * headless Chromium (Tone.Offline → deterministic PCM) and measures
 * acoustic facts: pitch, loudness response, durations, pedal tails,
 * strum staggering, clipping, and post-stop silence.
 *
 * What this proves: acoustically measurable correctness. What it does
 * NOT prove: subjective realism/tone beauty (deferred to human
 * listening — never claimed here).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MODEL_TOLERANCE_CENTS = 25

// ---------- tiny signal analysis (test-only, no dependencies) ----------

function toMidi(frequency) {
  return 69 + 12 * Math.log2(frequency / 440)
}

function centsError(measuredHz, expectedMidi) {
  return 1200 * Math.log2(measuredHz / (440 * 2 ** ((expectedMidi - 69) / 12)))
}

function f0Autocorr(samples, sampleRate, fromSeconds, windowSeconds = 0.4) {
  const start = Math.floor(fromSeconds * sampleRate)
  const length = Math.min(Math.floor(windowSeconds * sampleRate), samples.length - start)
  if (length <= 0) {
    return 0
  }
  const seg = samples.subarray(start, start + length)
  let bestLag = 0
  let bestValue = 0
  for (let lag = Math.floor(sampleRate / 1200); lag < Math.floor(sampleRate / 40); lag += 1) {
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

function peakAbsolute(samples, fromSeconds = 0, toSeconds = Infinity, sampleRate = 44100) {
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

/** Total energy in a time window (release/tail comparisons). */
function windowEnergy(samples, sampleRate, fromSeconds, toSeconds) {
  const start = Math.max(0, Math.floor(fromSeconds * sampleRate))
  const end = Math.min(samples.length, Math.floor(toSeconds * sampleRate))
  let total = 0
  for (let index = start; index < end; index += 1) {
    total += samples[index] * samples[index]
  }
  return total
}

/**
 * Locate each solo string's attack transient inside a mix via
 * transient matched filtering (first-difference kills the shared room
 * tone; the template covers the pick preamble + attack only).
 * Returns absolute lags in seconds — the TRANSIENTS align, so only
 * relative lag differences are meaningful.
 */
function matchedFilterLags(solos, mix, sampleRate) {
  const toIndex = (time) => Math.floor(time * sampleRate)
  const differentiate = (array) => {
    const out = new Float32Array(array.length)
    for (let index = 1; index < array.length; index += 1) {
      out[index] = array[index] - array[index - 1]
    }
    return out
  }
  const mixDiff = differentiate(mix)
  const templateStart = toIndex(0.54)
  const templateEnd = toIndex(0.6)
  return solos.map((solo) => {
    const template = differentiate(solo.subarray(templateStart, templateEnd))
    let best = -Infinity
    let bestLag = 0
    for (let lag = toIndex(0.48); lag < toIndex(0.6); lag += 1) {
      let score = 0
      for (let index = 0; index < template.length; index += 2) {
        score += template[index] * mixDiff[lag + index]
      }
      if (score > best) {
        best = score
        bestLag = lag
      }
    }
    return bestLag / sampleRate
  })
}

/** Spectral centroid (Hz) over a window — the standard brightness measure. */
function spectralCentroid(samples, sampleRate, fromSeconds, toSeconds) {
  const start = Math.max(0, Math.floor(fromSeconds * sampleRate))
  const end = Math.min(samples.length, Math.floor(toSeconds * sampleRate))
  let size = 1
  while (size < end - start) {
    size *= 2
  }
  const real = new Float64Array(size)
  const imag = new Float64Array(size)
  for (let index = start; index < end; index += 1) {
    const phase = (index - start) / (end - start)
    real[index - start] = samples[index] * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase))
  }
  // Bit-reversal permutation, then iterative decimation-in-time butterflies.
  let bits = 0
  for (let n = size; n > 1; n /= 2) {
    bits += 1
  }
  for (let index = 0; index < size; index += 1) {
    let reversed = 0
    for (let bit = 0; bit < bits; bit += 1) {
      reversed = (reversed << 1) | ((index >>> bit) & 1)
    }
    if (reversed > index) {
      const tempReal = real[index]
      const tempImag = imag[index]
      real[index] = real[reversed]
      imag[index] = imag[reversed]
      real[reversed] = tempReal
      imag[reversed] = tempImag
    }
  }
  for (let half = 1; half < size; half *= 2) {
    for (let base = 0; base < size; base += 2 * half) {
      for (let k = 0; k < half; k += 1) {
        const angle = (-Math.PI * k) / half
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const even = base + k
        const odd = even + half
        const tempReal = real[odd] * cos - imag[odd] * sin
        const tempImag = real[odd] * sin + imag[odd] * cos
        real[odd] = real[even] - tempReal
        imag[odd] = imag[even] - tempImag
        real[even] += tempReal
        imag[even] += tempImag
      }
    }
  }
  let weighted = 0
  let total = 0
  for (let bin = 1; bin < size / 2; bin += 1) {
    const frequency = (bin * sampleRate) / size
    if (frequency < 150 || frequency > 9000) {
      continue
    }
    const magnitude = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin])
    weighted += frequency * magnitude
    total += magnitude
  }
  return total > 0 ? weighted / total : 0
}

/** Last time the envelope sits within dropDb of the render's own peak. */
function lastAboveDb(samples, sampleRate, dropDb, fromSeconds = 0) {
  const peak = peakAbsolute(samples, fromSeconds, Infinity, sampleRate)
  const threshold = peak * 10 ** (-Math.abs(dropDb) / 20)
  const hop = Math.floor(sampleRate * 0.01)
  let last = fromSeconds
  for (let start = Math.floor(fromSeconds * sampleRate); start < samples.length; start += hop) {
    let sum = 0
    const end = Math.min(start + hop, samples.length)
    for (let index = start; index < end; index += 1) {
      sum += samples[index] * samples[index]
    }
    if (Math.sqrt(sum / (end - start)) >= threshold) {
      last = start / sampleRate
    }
  }
  return last
}

// ---------- harness ----------

describe('rendered audio validation (real Tone.js render)', () => {
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

  async function render(spec) {
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/audio-render/render.html`, { waitUntil: 'load' })
    const results = await page.evaluate(async (job) => window.__renderApi.render(job), spec)
    await page.close()
    return { samples: Float32Array.from(results.samples), sampleRate: results.sampleRate, engineType: results.engineType }
  }

  it('renders correct piano pitches (C4/E4/G4 triad voices)', async () => {
    for (const [name, midi] of [['C4', 60], ['E4', 64], ['G4', 67]]) {
      const { samples, sampleRate, engineType } = await render({
        voice: 'piano',
        notes: [{ name, time: 0.2, duration: 1.0, velocity: 0.8 }],
      })
      expect(engineType).toBe('sampler')
      const f0 = f0Autocorr(samples, sampleRate, 0.3)
      expect(Math.abs(centsError(f0, midi))).toBeLessThan(MODEL_TOLERANCE_CENTS)
    }
  }, 120_000)

  it('renders correct acoustic and electric guitar pitches', async () => {
    const acoustic = await render({
      voice: 'guitar',
      notes: [{ name: 'E3', time: 0.2, duration: 1.0, velocity: 0.8 }],
    })
    expect(acoustic.engineType).toBe('sampler')
    expect(Math.abs(centsError(f0Autocorr(acoustic.samples, acoustic.sampleRate, 0.3), 52))).toBeLessThan(MODEL_TOLERANCE_CENTS)
    const electric = await render({
      voice: 'electric',
      notes: [{ name: 'A3', time: 0.2, duration: 1.0, velocity: 0.8 }],
    })
    expect(electric.engineType).toBe('sampler')
    expect(Math.abs(centsError(f0Autocorr(electric.samples, electric.sampleRate, 0.3), 57))).toBeLessThan(MODEL_TOLERANCE_CENTS)
  }, 120_000)

  it('responds to velocity with loudness AND brightness', async () => {
    const soft = await render({ voice: 'piano', notes: [{ name: 'C4', time: 0.2, duration: 1.0, velocity: 0.3 }] })
    const loud = await render({ voice: 'piano', notes: [{ name: 'C4', time: 0.2, duration: 1.0, velocity: 0.9 }] })
    const softRms = rms(soft.samples, 0.25, 0.75, soft.sampleRate)
    const loudRms = rms(loud.samples, 0.25, 0.75, loud.sampleRate)
    expect(loudRms / softRms).toBeGreaterThan(1.5)
    const softCentroid = spectralCentroid(soft.samples, soft.sampleRate, 0.3, 0.7)
    const loudCentroid = spectralCentroid(loud.samples, loud.sampleRate, 0.3, 0.7)
    expect(loudCentroid).toBeGreaterThan(softCentroid * 1.1)
  }, 120_000)

  it('shortens staccato notes and extends pedalled releases', async () => {
    const plain = await render({ voice: 'piano', notes: [{ name: 'C4', time: 0.2, duration: 1.0, velocity: 0.8 }] })
    const staccato = await render({ voice: 'piano', notes: [{ name: 'C4', time: 0.2, duration: 0.5, velocity: 0.8 }] })
    // After both notes have ended, the staccato render must hold far less
    // energy (measured 44× less — margin set at 10×).
    const plainTail = windowEnergy(plain.samples, plain.sampleRate, 1.0, 2.0)
    const staccatoTail = windowEnergy(staccato.samples, staccato.sampleRate, 1.0, 2.0)
    expect(staccatoTail).toBeLessThan(plainTail / 10)
    const pedalled = await render({ voice: 'piano', notes: [{ name: 'C4', time: 0.2, duration: 2.8, velocity: 0.8 }] })
    // While the plain note has been released, the pedalled note still
    // sustains (measured 119× more energy — margin set at 10×).
    const plainLate = windowEnergy(plain.samples, plain.sampleRate, 1.5, 2.5)
    const pedalledLate = windowEnergy(pedalled.samples, pedalled.sampleRate, 1.5, 2.5)
    expect(pedalledLate).toBeGreaterThan(plainLate * 10)
  }, 180_000)

  it('staggers guitar strums low→high: each string transient lands 9 ms apart in the mix', async () => {
    const names = ['E2', 'A2', 'D3']
    const solos = []
    for (const name of names) {
      solos.push(await render({ voice: 'guitar', notes: [{ name, time: 0.5, duration: 1.5, velocity: 0.83 }] }))
    }
    const strummed = await render({
      voice: 'guitar',
      notes: names.map((name, index) => ({ name, time: 0.5 + index * 0.009, duration: 1.5, velocity: 0.83 })),
    })
    const lags = matchedFilterLags(
      solos.map((solo) => solo.samples),
      strummed.samples,
      strummed.sampleRate,
    )
    // The schedule staggers strings by 9 ms; the rendered transients must
    // reproduce that spacing (measured exactly 9.0/9.0 ms — margin ±4 ms).
    expect(lags[1] - lags[0]).toBeGreaterThan(0.005)
    expect(lags[1] - lags[0]).toBeLessThan(0.013)
    expect(lags[2] - lags[1]).toBeGreaterThan(0.005)
    expect(lags[2] - lags[1]).toBeLessThan(0.013)
  }, 180_000)

  it('never clips a full-velocity dense chord and goes silent after stopping', async () => {
    const dense = await render({
      voice: 'piano',
      notes: [60, 64, 67, 72, 76, 79].map((midi, index) => ({
        name: ['C4', 'E4', 'G4', 'C5', 'E5', 'G5'][index],
        time: 0.2,
        duration: 1.0,
        velocity: 1.0,
      })),
      tailSeconds: 3.0,
    })
    expect(peakAbsolute(dense.samples)).toBeLessThan(1.0)
    const tailRms = rms(dense.samples, 3.5, 4.0, dense.sampleRate)
    expect(tailRms).toBeLessThan(10 ** (-60 / 20))
  }, 120_000)

  it('damps palm-muted notes short', async () => {
    const ringing = await render({ voice: 'guitar', notes: [{ name: 'E3', time: 0.2, duration: 1.0, velocity: 0.8 }] })
    const muted = await render({ voice: 'guitar', notes: [{ name: 'E3', time: 0.2, duration: 1.0, velocity: 0.8, muted: true }] })
    const ringingEnd = lastAboveDb(ringing.samples, ringing.sampleRate, -20, 0.2)
    const mutedEnd = lastAboveDb(muted.samples, muted.sampleRate, -20, 0.2)
    expect(mutedEnd).toBeLessThan(ringingEnd - 0.2)
  }, 120_000)
})
