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

function f0Autocorr(samples, sampleRate, fromSeconds, windowSeconds = 0.4, fminHz = 40, fmaxHz = 1200) {
  const start = Math.floor(fromSeconds * sampleRate)
  const length = Math.min(Math.floor(windowSeconds * sampleRate), samples.length - start)
  if (length <= 0) {
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

  /** High-frequency energy ratio — what the velocity-brightness filter moves. */
function hfEnergyRatio(samples, sampleRate, fromSeconds, toSeconds) {
  const start = Math.max(1, Math.floor(fromSeconds * sampleRate))
  const end = Math.min(samples.length, Math.floor(toSeconds * sampleRate))
  let hf = 0
  let total = 0
  for (let index = start; index < end; index += 1) {
    const delta = samples[index] - samples[index - 1]
    hf += delta * delta
    total += samples[index] * samples[index]
  }
  return total > 0 ? hf / total : 0
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
function matchedFilterLags(solos, mix, sampleRate, opts = {}) {
  const toIndex = (time) => Math.floor(time * sampleRate)
  const differentiate = (array) => {
    const out = new Float32Array(array.length)
    for (let index = 1; index < array.length; index += 1) {
      out[index] = array[index] - array[index - 1]
    }
    return out
  }
  const mixDiff = differentiate(mix)
  const templateStart = toIndex(opts.templateStart ?? 0.54)
  const templateEnd = toIndex(opts.templateEnd ?? 0.6)
  const searchStart = toIndex(opts.searchStart ?? 0.48)
  const searchEnd = toIndex(opts.searchEnd ?? 0.6)
  return solos.map((solo) => {
    const template = differentiate(solo.subarray(templateStart, templateEnd))
    let best = -Infinity
    let bestLag = 0
    for (let lag = searchStart; lag < searchEnd; lag += 1) {
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

  async function renderScore(job) {
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/scripts/audio-render/render.html`, { waitUntil: 'load' })
    const results = await page.evaluate(async (task) => window.__renderApi.renderSchedule(task), job)
    await page.close()
    return {
      samples: Float32Array.from(results.samples),
      sampleRate: results.sampleRate,
      engineType: results.engineType,
      schedule: results.schedule,
    }
  }

  function scoreXml(measuresInner, partId = 'P1') {
    return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1">` +
      `<part-list><score-part id="${partId}"><part-name>Music</part-name></score-part></part-list>` +
      `<part id="${partId}">${measuresInner}</part></score-partwise>`
  }

  function qNote(step, octave = 4, duration = 1, extra = '') {
    return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
      `<duration>${duration}</duration><voice>1</voice><type>quarter</type>${extra}</note>`
  }

  /** Attack-onset cluster starts via HF-flux peaks (percussive attacks). */
  function onsetClusterStarts(samples, sampleRate, fromSeconds, toSeconds, clusterSeconds = 0.3) {
    const hop = Math.floor(sampleRate * 0.002)
    const rows = []
    let previous = 0
    for (let start = Math.floor(fromSeconds * sampleRate); start < Math.floor(toSeconds * sampleRate); start += hop) {
      let sum = 0
      const end = Math.min(start + hop, samples.length)
      for (let index = Math.max(start + 1, 1); index < end; index += 1) {
        const delta = samples[index] - samples[index - 1]
        sum += delta * delta
      }
      const level = sum / (end - start)
      rows.push([start / sampleRate, level - previous])
      previous = level
    }
    const peak = Math.max(...rows.map((row) => row[1]))
    const starts = []
    let last = -Infinity
    for (const [time, rise] of rows) {
      if (rise > 0.25 * peak && time - last > 0.2) {
        if (!starts.length || time - starts[starts.length - 1] > clusterSeconds) {
          starts.push(time)
        }
        last = time
      }
    }
    return starts
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
    // Brightness is a per-note filter move, so it is measured with the HF
    // ratio the filter acts on (measured 1.29× — margin 1.15×). Spectral
    // centroid proved too sample-dominated to pin (flaky across runs).
    const softHf = hfEnergyRatio(soft.samples, soft.sampleRate, 0.2, 0.9)
    const loudHf = hfEnergyRatio(loud.samples, loud.sampleRate, 0.2, 0.9)
    expect(loudHf).toBeGreaterThan(softHf * 1.15)
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

  it('renders the full piano dynamic ladder pp→fff in order', async () => {
    const ladder = [['pp', 0.36], ['p', 0.46], ['mp', 0.56], ['mf', 0.7], ['f', 0.82], ['ff', 0.91], ['fff', 0.98]]
    const levels = []
    for (const [mark, velocity] of ladder) {
      const rendered = await render({ voice: 'piano', notes: [{ name: 'C4', time: 0.2, duration: 1.0, velocity }] })
      expect(rendered.engineType).toBe('sampler')
      levels.push([mark, rms(rendered.samples, 0.25, 0.75, rendered.sampleRate)])
    }
    // Strictly rising except the limiter ceiling: ff→fff saturates honestly
    // (measured 0.99× — margin 0.95×), everything else rises ≥5% per step.
    for (let index = 1; index < levels.length; index += 1) {
      const floor = index === levels.length - 1 ? 0.95 : 1.05
      expect(levels[index][1]).toBeGreaterThan(levels[index - 1][1] * floor)
    }
    expect(levels[5][1]).toBeGreaterThan(levels[0][1] * 1.5)
  }, 240_000)

  // Same pitch throughout: an ascending line would conflate the sample's
  // own pitch brightness with the wedge ramp (that confound failed
  // diminuendo once — higher pitches read louder despite falling velocity).
  function hairpinScore(wedgeType, startDynamic) {
    const notes = ['C', 'C', 'C', 'C'].map((step) => qNote(step)).join('')
    return scoreXml(
      `<measure number="1"><attributes><divisions>1</divisions>` +
      `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
      `<direction><sound tempo="120"/></direction>` +
      `<direction><direction-type><dynamics><${startDynamic}/></dynamics></direction-type></direction>` +
      `<direction><direction-type><wedge type="${wedgeType}"/></direction-type></direction>` +
      `${notes}<direction><direction-type><wedge type="stop"/></direction-type></direction></measure>`,
    )
  }

  /** Per-note attack energies at the four quarter onsets (0, 0.5, 1, 1.5). */
  function quarterAttackEnergies(samples, sampleRate) {
    return [0, 0.5, 1, 1.5].map((onset) =>
      windowEnergy(samples, sampleRate, onset + 0.05, onset + 0.3),
    )
  }

  it('performs a crescendo end to end: parsed wedge → rising velocities → rising attacks', async () => {
    const rendered = await renderScore({ musicXml: hairpinScore('crescendo', 'pp'), voice: 'piano', instrumentId: 'piano' })
    expect(rendered.engineType).toBe('sampler')
    const velocities = rendered.schedule.map((event) => event.velocity)
    expect(velocities.length).toBe(4)
    for (let index = 1; index < velocities.length; index += 1) {
      expect(velocities[index]).toBeGreaterThan(velocities[index - 1])
    }
    const attacks = quarterAttackEnergies(rendered.samples, rendered.sampleRate)
    for (let index = 1; index < attacks.length; index += 1) {
      expect(attacks[index]).toBeGreaterThan(attacks[index - 1] * 1.03)
    }
  }, 120_000)

  it('performs a diminuendo end to end: falling velocities → falling attacks', async () => {
    const rendered = await renderScore({ musicXml: hairpinScore('diminuendo', 'f'), voice: 'piano', instrumentId: 'piano' })
    expect(rendered.engineType).toBe('sampler')
    const velocities = rendered.schedule.map((event) => event.velocity)
    expect(velocities.length).toBe(4)
    for (let index = 1; index < velocities.length; index += 1) {
      expect(velocities[index]).toBeLessThan(velocities[index - 1])
    }
    const attacks = quarterAttackEnergies(rendered.samples, rendered.sampleRate)
    for (let index = 1; index < attacks.length; index += 1) {
      expect(attacks[index]).toBeLessThan(attacks[index - 1] * 0.97)
    }
  }, 120_000)

  it('performs a tempo change end to end: schedule times and rendered onsets halve the gap', async () => {
    const xml = scoreXml(
      `<measure number="1"><attributes><divisions>1</divisions>` +
      `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
      `<direction><sound tempo="120"/></direction>${qNote('C', 4, 2)}</measure>` +
      `<measure number="2"><direction><sound tempo="60"/></direction>${qNote('E')}${qNote('F')}</measure>`,
    )
    const rendered = await renderScore({ musicXml: xml, voice: 'piano', instrumentId: 'piano' })
    expect(rendered.schedule.map((event) => event.time)).toEqual([0, 2, 3])
    const starts = onsetClusterStarts(rendered.samples, rendered.sampleRate, 0, 3.5)
    expect(starts.length).toBe(3)
    const ratio = (starts[1] - starts[0]) / (starts[2] - starts[1])
    expect(ratio).toBeGreaterThan(1.7)
    expect(ratio).toBeLessThan(2.3)
  }, 120_000)

  it('renders harmonics honestly at written pitch (no faked harmonic timbre)', async () => {
    // A real 12th-fret harmonic would sound an octave up; the sampler
    // cannot voice that, so the note renders at written pitch and the
    // marking stays recognized-only. This test pins that honesty.
    const xml = scoreXml(
      `<measure number="1"><attributes><divisions>1</divisions>` +
      `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
      `<direction><sound tempo="120"/></direction>` +
      `<note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice>` +
      `<type>quarter</type><notations><technical><harmonic/></technical></notations></note></measure>`,
    )
    const rendered = await renderScore({ musicXml: xml, voice: 'guitar', instrumentId: 'guitar' })
    expect(rendered.engineType).toBe('sampler')
    expect(rendered.schedule[0].recognizedOnlyTechniques).toContain('harmonic')
    expect(rendered.schedule[0].performedTechniques).not.toContain('harmonic')
    const f0 = f0Autocorr(rendered.samples, rendered.sampleRate, 0.3)
    expect(Math.abs(centsError(f0, 52))).toBeLessThan(MODEL_TOLERANCE_CENTS)
  }, 120_000)

  it('renders hammer-on notes softer through the full score path', async () => {
    const plainXml = scoreXml(
      `<measure number="1"><attributes><divisions>1</divisions>` +
      `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
      `<direction><sound tempo="120"/></direction>${qNote('E', 3)}</measure>`,
    )
    const hammerXml = scoreXml(
      `<measure number="1"><attributes><divisions>1</divisions>` +
      `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
      `<direction><sound tempo="120"/></direction>` +
      `<note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice>` +
      `<type>quarter</type><notations><technical><hammer-on type="start"/></technical></notations></note></measure>`,
    )
    const plain = await renderScore({ musicXml: plainXml, voice: 'guitar', instrumentId: 'guitar' })
    const hammered = await renderScore({ musicXml: hammerXml, voice: 'guitar', instrumentId: 'guitar' })
    expect(hammered.schedule[0].performedTechniques).toContain('hammer-on')
    expect(hammered.schedule[0].velocity).toBeLessThan(plain.schedule[0].velocity)
    const plainRms = rms(plain.samples, 0.15, 0.45, plain.sampleRate)
    const hammerRms = rms(hammered.samples, 0.15, 0.45, hammered.sampleRate)
    expect(hammerRms).toBeLessThan(plainRms * 0.95)
  }, 120_000)

  it('renders palm mute end to end from notation text', async () => {
    const xml = scoreXml(
      `<measure number="1"><attributes><divisions>1</divisions>` +
      `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
      `<direction><sound tempo="120"/></direction>` +
      `<note><pitch><step>E</step><octave>3</octave></pitch><duration>2</duration><voice>1</voice>` +
      `<type>half</type><notations><technical><other-technical>palm mute</other-technical></technical></notations></note></measure>`,
    )
    const rendered = await renderScore({ musicXml: xml, voice: 'guitar', instrumentId: 'guitar' })
    expect(rendered.schedule[0].muted).toBe(true)
    const ringing = await render({ voice: 'guitar', notes: [{ name: 'E3', time: 0, duration: 1.0, velocity: 0.8 }] })
    const mutedTail = windowEnergy(rendered.samples, rendered.sampleRate, 0.5, 1.5)
    const ringingTail = windowEnergy(ringing.samples, ringing.sampleRate, 0.5, 1.5)
    expect(mutedTail).toBeLessThan(ringingTail / 5)
  }, 120_000)

  it('acoustic and electric guitars render the same pitch with clearly different sound', async () => {
    const acoustic = await render({ voice: 'guitar', notes: [{ name: 'A3', time: 0.2, duration: 1.0, velocity: 0.8 }] })
    const electric = await render({ voice: 'electric', notes: [{ name: 'A3', time: 0.2, duration: 1.0, velocity: 0.8 }] })
    expect(acoustic.engineType).toBe('sampler')
    expect(electric.engineType).toBe('sampler')
    expect(Math.abs(centsError(f0Autocorr(acoustic.samples, acoustic.sampleRate, 0.3), 57))).toBeLessThan(MODEL_TOLERANCE_CENTS)
    expect(Math.abs(centsError(f0Autocorr(electric.samples, electric.sampleRate, 0.3), 57))).toBeLessThan(MODEL_TOLERANCE_CENTS)
    let dot = 0
    let normA = 0
    let normE = 0
    for (let index = 0; index < acoustic.samples.length; index += 2) {
      dot += acoustic.samples[index] * electric.samples[index]
      normA += acoustic.samples[index] * acoustic.samples[index]
      normE += electric.samples[index] * electric.samples[index]
    }
    expect(dot / Math.sqrt(normA * normE)).toBeLessThan(0.9)
  }, 120_000)

  it('renders accents louder and fermatas longer through the score path', async () => {    const plainXml = scoreXml(
      `<measure number="1"><attributes><divisions>1</divisions>` +
      `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
      `<direction><sound tempo="120"/></direction>${qNote('C')}</measure>`,
    )
    const plain = await renderScore({ musicXml: plainXml, voice: 'piano', instrumentId: 'piano' })
    const accentXml = scoreXml(
      `<measure number="1"><attributes><divisions>1</divisions>` +
      `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
      `<direction><sound tempo="120"/></direction>` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice>` +
      `<type>quarter</type><notations><articulations><accent/></articulations></notations></note></measure>`,
    )
    const accented = await renderScore({ musicXml: accentXml, voice: 'piano', instrumentId: 'piano' })
    expect(accented.schedule[0].velocity).toBeGreaterThan(plain.schedule[0].velocity)
    const plainRms = rms(plain.samples, 0.1, 0.5, plain.sampleRate)
    const accentRms = rms(accented.samples, 0.1, 0.5, accented.sampleRate)
    expect(accentRms).toBeGreaterThan(plainRms * 1.05)
    const fermataXml = scoreXml(
      `<measure number="1"><attributes><divisions>1</divisions>` +
      `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
      `<direction><sound tempo="120"/></direction>` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice>` +
      `<type>quarter</type><notations><fermata/></notations></note></measure>`,
    )
    const fermata = await renderScore({ musicXml: fermataXml, voice: 'piano', instrumentId: 'piano' })
    expect(fermata.schedule[0].performedDurationSeconds).toBeCloseTo(
      plain.schedule[0].performedDurationSeconds * 1.75, 6,
    )
    const plainLate = windowEnergy(plain.samples, plain.sampleRate, 0.6, 1.4)
    const fermataLate = windowEnergy(fermata.samples, fermata.sampleRate, 0.6, 1.4)
    expect(fermataLate).toBeGreaterThan(plainLate * 1.15)
  }, 180_000)

  function guitarNoteXml(step, octave, duration, notations) {
    return scoreXml(
      `<measure number="1"><attributes><divisions>1</divisions>` +
      `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
      `<direction><sound tempo="120"/></direction>` +
      `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>1</voice>` +
      `<type>half</type><notations>${notations}</notations></note></measure>`,
    )
  }

  it('bends a guitar note along the parsed trajectory (E3→F, no chord bleed)', async () => {
    const rendered = await renderScore({
      musicXml: guitarNoteXml('E', 3, 2, `<technical><bend><bend-alter>1</bend-alter></bend></technical>`),
      voice: 'guitar',
      instrumentId: 'guitar',
    })
    expect(rendered.schedule[0].pitchCurve).toMatchObject({ type: 'bend', semitones: 1 })
    // Technique voice starts immediately (no sample preamble): early
    // window is still flat, late window holds the bent pitch.
    const early = f0Autocorr(rendered.samples, rendered.sampleRate, 0.02, 0.08)
    const late = f0Autocorr(rendered.samples, rendered.sampleRate, 0.5, 0.2)
    expect(Math.abs(centsError(early, 52))).toBeLessThan(75)
    expect(Math.abs(centsError(late, 53))).toBeLessThan(MODEL_TOLERANCE_CENTS)
  }, 120_000)

  it('releases a bent note back to pitch', async () => {
    const rendered = await renderScore({
      musicXml: guitarNoteXml('E', 3, 2, `<technical><bend><bend-alter>2</bend-alter><release/></bend></technical>`),
      voice: 'guitar',
      instrumentId: 'guitar',
    })
    expect(rendered.schedule[0].pitchCurve.type).toBe('bend-release')
    const mid = f0Autocorr(rendered.samples, rendered.sampleRate, 0.35, 0.12)
    const late = f0Autocorr(rendered.samples, rendered.sampleRate, 0.75, 0.2)
    expect(Math.abs(centsError(mid, 54))).toBeLessThan(75)
    expect(Math.abs(centsError(late, 52))).toBeLessThan(50)
  }, 120_000)

  it('slides between paired notes with no silence gap', async () => {
    const xml = scoreXml(
      `<measure number="1"><attributes><divisions>1</divisions>` +
      `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
      `<direction><sound tempo="120"/></direction>` +
      `<note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice>` +
      `<type>quarter</type><notations><slide type="start"/></notations></note>` +
      `<note><pitch><step>G</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice>` +
      `<type>quarter</type><notations><slide type="stop"/></notations></note></measure>`,
    )
    const rendered = await renderScore({ musicXml: xml, voice: 'guitar', instrumentId: 'guitar' })
    expect(rendered.schedule[0].pitchCurve).toMatchObject({ type: 'slide', targetMidi: 55 })
    const early = f0Autocorr(rendered.samples, rendered.sampleRate, 0.03, 0.08)
    const late = f0Autocorr(rendered.samples, rendered.sampleRate, 0.42, 0.1)
    expect(Math.abs(centsError(early, 52))).toBeLessThan(75)
    expect(Math.abs(centsError(late, 55))).toBeLessThan(MODEL_TOLERANCE_CENTS)
    let floor = Infinity
    for (let time = 0.05; time < 0.45; time += 0.05) {
      const energy = windowEnergy(rendered.samples, rendered.sampleRate, time, time + 0.05)
      if (energy < floor) {
        floor = energy
      }
    }
    const peak = windowEnergy(rendered.samples, rendered.sampleRate, 0.1, 0.2)
    expect(floor).toBeGreaterThan(peak * 0.05)
  }, 120_000)

  it('plays vibrato at the documented rate and depth', async () => {
    const rendered = await renderScore({
      musicXml: guitarNoteXml('A', 3, 4, `<ornaments><wavy-line type="start"/></ornaments>`),
      voice: 'guitar',
      instrumentId: 'guitar',
    })
    expect(rendered.schedule[0].pitchCurve).toMatchObject({ type: 'vibrato', rateHz: 5.5 })
    const contour = []
    for (let time = 0.4; time < 1.6; time += 0.04) {
      contour.push(f0Autocorr(rendered.samples, rendered.sampleRate, time, 0.08, 150, 350))
    }
    const mean = contour.reduce((sum, value) => sum + value, 0) / contour.length
    const peakToPeak = Math.max(...contour) - Math.min(...contour)
    expect(peakToPeak).toBeGreaterThan(6)
    let crossings = 0
    for (let index = 1; index < contour.length; index += 1) {
      if ((contour[index - 1] - mean) * (contour[index] - mean) < 0) {
        crossings += 1
      }
    }
    // ~5.5 Hz over ~1.2 s ≈ 6–7 periods ≈ 12–14 crossings; wide gate.
    expect(crossings).toBeGreaterThanOrEqual(6)
    expect(crossings).toBeLessThanOrEqual(20)
  }, 120_000)

  it('bends one chord tone while the other stays static (residue proof)', async () => {
    const solo = await render({
      voice: 'guitar',
      notes: [{ name: 'E3', midi: 52, time: 0.2, duration: 1.2, velocity: 0.8, pitchCurve: { type: 'bend', semitones: 2, rampSeconds: 0.3 } }],
    })
    const mix = await render({
      voice: 'guitar',
      notes: [
        { name: 'E3', midi: 52, time: 0.2, duration: 1.2, velocity: 0.8, pitchCurve: { type: 'bend', semitones: 2, rampSeconds: 0.3 } },
        { name: 'B3', midi: 59, time: 0.2, duration: 1.2, velocity: 0.8 },
      ],
    })
    // Deterministic renders subtract cleanly: what remains must be the
    // static B3. A whole-chord bend bug would leave a gliding residue.
    const residue = mix.samples.map((value, index) => value - solo.samples[index])
    for (const time of [0.4, 0.7, 1.0]) {
      const f0 = f0Autocorr(Float32Array.from(residue), mix.sampleRate, time, 0.15, 200, 300)
      expect(Math.abs(centsError(f0, 59))).toBeLessThan(50)
    }
  }, 120_000)

  it('sounds hammer-ons connected: earlier tone onset, no pick-weight front', async () => {
    const plainXml = guitarNoteXml('E', 3, 1, '')
    const plain = await renderScore({ musicXml: plainXml, voice: 'guitar', instrumentId: 'guitar' })
    const hammerXml = guitarNoteXml('E', 3, 1, `<technical><hammer-on type="start"/></technical>`)
    const hammered = await renderScore({ musicXml: hammerXml, voice: 'guitar', instrumentId: 'guitar' })
    expect(hammered.schedule[0].slurAttack).toMatchObject({ attackSeconds: 0.03 })
    const frontLoad = (samples, sampleRate) =>
      windowEnergy(samples, sampleRate, 0.01, 0.06) / windowEnergy(samples, sampleRate, 0.01, 0.2)
    const timeToTone = (samples, sampleRate) => {
      const total = windowEnergy(samples, sampleRate, 0, 0.4)
      let cumulative = 0
      for (let index = 0; index < Math.floor(0.4 * sampleRate); index += 1) {
        cumulative += samples[index] * samples[index]
        if (cumulative >= 0.1 * total) {
          return index / sampleRate
        }
      }
      return -1
    }
    expect(frontLoad(hammered.samples, hammered.sampleRate)).toBeGreaterThan(
      frontLoad(plain.samples, plain.sampleRate) * 5,
    )
    // Deterministic renders make the 15 ms gap stable; margin 10 ms.
    expect(timeToTone(hammered.samples, hammered.sampleRate)).toBeLessThan(
      timeToTone(plain.samples, plain.sampleRate) - 0.01,
    )
  }, 120_000)

  it('realizes trill alternation, mordent and turn pitches in audio', async () => {
    const ornamentXml = (notations, duration = 4) => scoreXml(
      `<measure number="1"><attributes><divisions>1</divisions>` +
      `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
      `<direction><sound tempo="120"/></direction>` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration><voice>1</voice>` +
      `<type>whole</type><notations>${notations}</notations></note></measure>`,
    )
    const trill = await renderScore({
      musicXml: ornamentXml(`<ornaments><trill-mark/></ornaments>`), voice: 'piano', instrumentId: 'piano',
    })
    expect(trill.schedule.length).toBeGreaterThanOrEqual(8)
    const slices = []
    for (let index = 0; index < 6; index += 1) {
      slices.push(f0Autocorr(trill.samples, trill.sampleRate, 0.03 + index * 0.125, 0.06, 200, 350))
    }
    for (let index = 0; index < slices.length; index += 1) {
      expect(Math.abs(centsError(slices[index], index % 2 === 0 ? 60 : 62))).toBeLessThan(75)
    }
    const mordent = await renderScore({
      musicXml: ornamentXml(`<ornaments><mordent/></ornaments>`, 2), voice: 'piano', instrumentId: 'piano',
    })
    const mordentPitches = [0.05, 0.38, 0.72].map((time) =>
      f0Autocorr(mordent.samples, mordent.sampleRate, time, 0.08, 200, 350),
    )
    expect(Math.abs(centsError(mordentPitches[0], 60))).toBeLessThan(50)
    expect(Math.abs(centsError(mordentPitches[1], 62))).toBeLessThan(50)
    expect(Math.abs(centsError(mordentPitches[2], 60))).toBeLessThan(50)
    const turn = await renderScore({
      musicXml: ornamentXml(`<ornaments><turn/></ornaments>`, 2), voice: 'piano', instrumentId: 'piano',
    })
    const turnPitches = [0.05, 0.3, 0.55, 0.8].map((time) =>
      f0Autocorr(turn.samples, turn.sampleRate, time, 0.07, 200, 350),
    )
    for (const [pitch, midi] of [[turnPitches[0], 62], [turnPitches[1], 60], [turnPitches[2], 59], [turnPitches[3], 60]]) {
      expect(Math.abs(centsError(pitch, midi))).toBeLessThan(75)
    }
  }, 240_000)

  it('staggers arpeggiated chords 12 ms apart in audio', async () => {
    const names = ['C4', 'E4', 'G4']
    const midis = [60, 64, 67]
    const solos = []
    for (let index = 0; index < 3; index += 1) {
      solos.push(await render({
        voice: 'piano', notes: [{ name: names[index], time: 0.5, duration: 1.5, velocity: 0.8 }],
      }))
    }
    const xml = scoreXml(
      `<measure number="1"><attributes><divisions>1</divisions>` +
      `<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>` +
      `<direction><sound tempo="120"/></direction>` +
      `<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>` +
      `<note><arpeggiate direction="up"/><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>` +
      `<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>` +
      `<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note></measure>`,
    )
    const arpeggiated = await renderScore({ musicXml: xml, voice: 'piano', instrumentId: 'piano' })
    const chord = arpeggiated.schedule.filter((event) => midis.includes(event.midi))
    expect(chord.map((event) => event.midi)).toEqual([60, 64, 67])
    const lags = matchedFilterLags(
      solos.map((solo) => solo.samples),
      arpeggiated.samples,
      arpeggiated.sampleRate,
    )
    expect(lags[1] - lags[0]).toBeGreaterThan(0.006)
    expect(lags[1] - lags[0]).toBeLessThan(0.018)
    expect(lags[2] - lags[1]).toBeGreaterThan(0.006)
    expect(lags[2] - lags[1]).toBeLessThan(0.018)
  }, 180_000)

  it('keeps fff louder than ff on chords without clipping', async () => {
    const chord = (velocity) => render({
      voice: 'piano',
      notes: ['C4', 'E4', 'G4'].map((name) => ({ name, time: 0.2, duration: 1.0, velocity })),
    })
    const ff = await chord(0.91)
    const fff = await chord(0.98)
    expect(windowEnergy(fff.samples, fff.sampleRate, 0.25, 0.75)).toBeGreaterThan(
      windowEnergy(ff.samples, ff.sampleRate, 0.25, 0.75),
    )
    expect(peakAbsolute(fff.samples)).toBeLessThan(1.0)
  }, 120_000)
})
